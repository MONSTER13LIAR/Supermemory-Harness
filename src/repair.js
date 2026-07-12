import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const LARGE_DB_BYTES = 120 * 1024 * 1024;
const SNAPSHOT_RISK_BYTES = 150 * 1024 * 1024;

export async function runRepair(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 100
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const checks = [];
  const actions = [];
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const documents = list.body?.memories ?? list.body?.documents ?? [];

  if (!list.ok) {
    checks.push(fail("Document inventory unavailable", responseDetail(list)));
  } else {
    checks.push(ok("Document inventory reachable", `${documents.length} sampled`));
  }

  const processing = await getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`);
  if (processing.ok) {
    checks.push(ok("Processing queue reachable", summarizeObject(processing.body)));
  } else {
    checks.push(warn("Processing queue unavailable", responseDetail(processing)));
  }

  const failed = documents.filter((doc) => ["failed", "error"].includes(doc.status));
  const queued = documents.filter((doc) => ["queued", "processing"].includes(doc.status));
  const stale = queued.filter((doc) => isStale(doc));
  const emptyContainers = await findEmptyMemoryContainers(context, documents);
  const storage = await inspectStorage(context.home);
  const logs = await inspectLogs(context.home);

  if (failed.length > 0) {
    checks.push(fail("Failed documents found", `${failed.length} of ${documents.length} sampled`));
    actions.push(plan("backup", "Export important memories before repair", "Use the Supermemory API/UI before deleting failed docs."));
    actions.push(plan("replay", "Replay failed documents safely", "Run smctl memory replay, then smctl memory replay --apply after reviewing the plan."));
  } else {
    checks.push(ok("No failed documents in sample", `${documents.length} sampled`));
  }

  if (stale.length > 0) {
    checks.push(fail("Stale queued documents found", `${stale.length} look stuck for more than 30 minutes`));
    actions.push(plan("restart", "Restart Supermemory Local", "A restart can clear transient stuck workers before replaying."));
    actions.push(plan("verify", "Verify recall after restart", "Run smctl verify to confirm write/search recovered."));
  } else if (queued.length > 0) {
    checks.push(warn("Active queued documents found", `${queued.length} still processing`));
  } else {
    checks.push(ok("No queued documents in sample", `${documents.length} sampled`));
  }

  if (emptyContainers.length > 0) {
    checks.push(warn("Documents exist but memories are empty", emptyContainers.map((item) => item.containerTag).join(", ")));
    actions.push(plan("recall", "Check write/read mismatch", "Run smctl verify; if writes work but recall fails, check API key/OAuth/containerTag mismatch."));
  }

  checks.push(storageCheck(storage));
  if (storage.risk !== "ok") {
    actions.push(plan("snapshot", "Reduce snapshot risk", "Keep backups outside .supermemory and avoid bulk ingest until Supermemory fixes snapshot chunking."));
  }

  if (logs.retryLoop.length > 0) {
    checks.push(fail("Retry loop hints in logs", logs.retryLoop.at(-1)));
    actions.push(plan("loop", "Stop retry-loop pressure", "Restart Supermemory Local, then replay only known-good failed docs."));
  } else if (logs.failures.length > 0) {
    checks.push(warn("Recent failure hints in logs", logs.failures.at(-1)));
  } else {
    checks.push(ok("No recent retry-loop hints", "~/.supermemory/server.log"));
  }

  const summary = summarize(checks);
  const result = {
    command: "repair",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    mode: "plan",
    documents: {
      sampled: documents.length,
      failed: failed.slice(0, 10).map(documentSummary),
      queued: queued.slice(0, 10).map(documentSummary),
      stale: stale.slice(0, 10).map(documentSummary)
    },
    storage,
    logs,
    emptyContainers,
    checks,
    actions,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatRepair(result);
  return result;
}

export async function repairWatchdog(options = {}) {
  const result = await runRepair({ ...options, limit: options.limit ?? 25 });
  const risky = result.summary.fail > 0 || result.storage.risk !== "ok";
  return {
    status: result.summary.fail > 0 ? "fail" : risky || result.summary.warn > 0 ? "warn" : "ok",
    detail: `${result.summary.fail} fail, ${result.summary.warn} warn; db ${formatBytes(result.storage.bytes)}`,
    result
  };
}

async function findEmptyMemoryContainers(context, documents) {
  const containerTags = unique(documents.flatMap((doc) => doc.containerTags ?? []));
  const empty = [];
  for (const tag of containerTags.slice(0, 5)) {
    const response = await postJson(context.fetch, `${context.baseUrl}/v4/memories/list`, {
      containerTags: [tag],
      limit: 5
    });
    const total = response.body?.pagination?.totalItems ?? response.body?.memoryEntries?.length ?? null;
    if (response.ok && total === 0 && documents.some((doc) => doc.status === "done" && (doc.containerTags ?? []).includes(tag))) {
      empty.push({ containerTag: tag, totalItems: total });
    }
  }
  return empty;
}

async function inspectStorage(home) {
  const candidates = [
    join(home, ".supermemory", "data", "data"),
    join(home, ".supermemory", "data")
  ];
  for (const path of candidates) {
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      const risk = info.size >= SNAPSHOT_RISK_BYTES ? "fail" : info.size >= LARGE_DB_BYTES ? "warn" : "ok";
      return {
        path: redactHome(path, home),
        bytes: info.size,
        risk
      };
    } catch {
      // Try the next known local store path.
    }
  }
  return { path: "~/.supermemory/data", bytes: 0, risk: "warn", missing: true };
}

async function inspectLogs(home) {
  try {
    const content = await readFile(join(home, ".supermemory", "server.log"), "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      failures: lines.filter((line) => /failed|error|oom|out of memory|RangeError/i.test(line)).slice(-10),
      retryLoop: lines.filter((line) => /Permanently failed|no retry params|missed execution|retry/i.test(line)).slice(-10)
    };
  } catch {
    return { failures: [], retryLoop: [] };
  }
}

function storageCheck(storage) {
  if (storage.missing) {
    return warn("Local store file not found", storage.path);
  }
  if (storage.risk === "fail") {
    return fail("Local store near snapshot risk zone", `${formatBytes(storage.bytes)} at ${storage.path}`);
  }
  if (storage.risk === "warn") {
    return warn("Local store is growing", `${formatBytes(storage.bytes)} at ${storage.path}`);
  }
  return ok("Local store size looks safe", `${formatBytes(storage.bytes)} at ${storage.path}`);
}

function isStale(doc) {
  const value = doc.updatedAt ?? doc.createdAt;
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > 30 * 60 * 1000;
}

function formatRepair(result) {
  const lines = [];
  lines.push("Supermemory Harness repair");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Sample: ${result.documents.sampled} documents`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }

  if (result.actions.length > 0) {
    lines.push("");
    lines.push("Repair plan:");
    for (const action of result.actions) {
      lines.push(`   ${action.title}`);
      lines.push(`      ${action.detail}`);
    }
  }

  if (result.documents.failed.length > 0) {
    lines.push("");
    lines.push("Failed documents:");
    for (const doc of result.documents.failed) {
      lines.push(`   ${doc.id}  ${doc.title}`);
    }
  }

  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: no blocking repair issue found in the sample."
    : "Result: repair issues found. Review the plan before applying any destructive cleanup.");
  return lines.join("\n");
}

async function postJson(fetchFn, url, body) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function getJson(fetchFn, url) {
  return requestJson(fetchFn, url, { method: "GET" });
}

async function requestJson(fetchFn, url, init) {
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      text: "",
      error: formatFetchError(error)
    };
  }
}

function documentSummary(doc) {
  return {
    id: doc.id,
    status: doc.status,
    title: doc.title ?? doc.customId ?? "(untitled)",
    containerTags: doc.containerTags ?? []
  };
}

function plan(kind, title, detail) {
  return { kind, title, detail };
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}

function summarizeObject(value) {
  if (!value || typeof value !== "object") return "reachable";
  const entries = Object.entries(value).slice(0, 5);
  return entries.length > 0 ? entries.map(([key, val]) => `${key}:${val}`).join(", ") : "reachable";
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function warn(title, detail) {
  return { status: "warn", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) {
    return `${error.message}: ${cause.code}`;
  }
  return error.message;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;
  const kib = bytes / 1024;
  if (kib >= 1) return `${kib.toFixed(1)} KiB`;
  return `${bytes} B`;
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
