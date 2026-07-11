import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export async function runMemory(options = {}) {
  const action = options.action ?? "doctor";
  if (action === "doctor") {
    return memoryDoctor(options);
  }
  if (action === "replay") {
    return memoryReplay(options);
  }
  if (!["doctor", "replay"].includes(action)) {
    throw new Error(`Unknown memory action: ${action}`);
  }
}

export async function memoryDoctor(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 50
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const checks = [];
  const documentsResponse = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "createdAt",
    order: "desc"
  });

  const documents = documentsResponse.body?.memories ?? documentsResponse.body?.documents ?? [];
  if (!documentsResponse.ok) {
    checks.push(fail("Document list unavailable", responseDetail(documentsResponse)));
  } else {
    checks.push(ok("Document list reachable", `${documents.length} sampled`));
  }

  const processingResponse = await getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`);
  if (processingResponse.ok) {
    checks.push(ok("Processing state reachable", summarizeObject(processingResponse.body)));
  } else {
    checks.push(warn("Processing state unavailable", responseDetail(processingResponse)));
  }

  const statusCounts = countBy(documents, (doc) => doc.status ?? "unknown");
  const failed = documents.filter((doc) => ["failed", "error"].includes(doc.status));
  const queued = documents.filter((doc) => ["queued", "processing"].includes(doc.status));
  const done = documents.filter((doc) => doc.status === "done");

  if (failed.length > 0) {
    checks.push(fail("Failed documents found", `${failed.length} of ${documents.length} sampled`));
  } else {
    checks.push(ok("No failed documents in sample", `${documents.length} sampled`));
  }

  if (queued.length > 0) {
    checks.push(warn("Queued or processing documents found", `${queued.length} still pending`));
  } else {
    checks.push(ok("No queued documents in sample", `${documents.length} sampled`));
  }

  const duplicateTitles = findDuplicateTitles(documents);
  if (duplicateTitles.length > 0) {
    checks.push(warn("Possible duplicate document titles", duplicateTitles.slice(0, 5).map((item) => `${item.count}x ${item.title}`).join("; ")));
  } else {
    checks.push(ok("No duplicate document titles in sample", `${documents.length} sampled`));
  }

  const failedHints = await recentFailureHints(context.home);
  if (failedHints.length > 0) {
    checks.push(fail("Recent memory pipeline failures in logs", failedHints.slice(-3).join(" | ")));
  } else {
    checks.push(ok("No recent memory-agent failures in server log", "~/.supermemory/server.log"));
  }

  const containerTags = unique(documents.flatMap((doc) => doc.containerTags ?? []));
  const memorySamples = [];
  for (const tag of containerTags.slice(0, 5)) {
    const response = await postJson(context.fetch, `${context.baseUrl}/v4/memories/list`, {
      containerTags: [tag],
      limit: 10
    });
    if (response.ok) {
      memorySamples.push({
        containerTag: tag,
        totalItems: response.body?.pagination?.totalItems ?? response.body?.memoryEntries?.length ?? 0
      });
    }
  }

  const zeroMemoryTags = memorySamples.filter((sample) => sample.totalItems === 0);
  if (done.length > 0 && zeroMemoryTags.length > 0) {
    checks.push(warn("Containers with documents but zero listed memories", zeroMemoryTags.map((sample) => sample.containerTag).join(", ")));
  } else if (memorySamples.length > 0) {
    checks.push(ok("Memory entries found for sampled containers", memorySamples.map((sample) => `${sample.containerTag}:${sample.totalItems}`).join(", ")));
  } else {
    checks.push(warn("No container tags available for memory sampling", "Add documents with containerTag to evaluate memory entries"));
  }

  const summary = summarize(checks);
  const result = {
    command: "memory doctor",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    limit: context.limit,
    documents: {
      sampled: documents.length,
      statusCounts,
      failed: failed.slice(0, 10).map(documentSummary),
      queued: queued.slice(0, 10).map(documentSummary)
    },
    memorySamples,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatMemoryDoctor(result);
  return result;
}

export async function memoryReplay(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25,
    apply: Boolean(options.apply)
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const listResponse = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });

  if (!listResponse.ok) {
    const result = {
      command: "memory replay",
      generatedAt: new Date().toISOString(),
      baseUrl: context.baseUrl,
      apply: context.apply,
      actions: [],
      summary: { replayed: 0, planned: 0, skipped: 0, failed: 1 },
      exitCode: 1
    };
    result.text = `Supermemory Harness memory replay\n[fail] Document list unavailable\n   ${responseDetail(listResponse)}`;
    return result;
  }

  const documents = listResponse.body?.memories ?? listResponse.body?.documents ?? [];
  const failed = documents.filter((doc) => ["failed", "error"].includes(doc.status));
  const actions = [];

  for (const doc of failed) {
    const detail = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${doc.id}`);
    if (!detail.ok) {
      actions.push({
        status: "failed",
        id: doc.id,
        title: doc.title ?? "(untitled)",
        detail: responseDetail(detail)
      });
      continue;
    }

    const replayBody = replayPayload(detail.body, doc.id);
    if (!replayBody.content) {
      actions.push({
        status: "skipped",
        id: doc.id,
        title: doc.title ?? "(untitled)",
        detail: "No replayable text content found"
      });
      continue;
    }

    if (!context.apply) {
      actions.push({
        status: "planned",
        id: doc.id,
        title: doc.title ?? "(untitled)",
        containerTag: replayBody.containerTag,
        detail: "Would resubmit document"
      });
      continue;
    }

    const replay = await postJson(context.fetch, `${context.baseUrl}/v3/documents`, replayBody);
    actions.push({
      status: replay.ok ? "replayed" : "failed",
      id: doc.id,
      title: doc.title ?? "(untitled)",
      newId: replay.body?.id,
      containerTag: replayBody.containerTag,
      detail: replay.ok ? `Queued as ${replay.body?.id}` : responseDetail(replay)
    });
  }

  const summary = summarizeReplay(actions);
  const result = {
    command: "memory replay",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    apply: context.apply,
    sampled: documents.length,
    actions,
    summary,
    exitCode: summary.failed > 0 ? 1 : 0
  };
  result.text = formatMemoryReplay(result);
  return result;
}

function replayPayload(document, originalId) {
  const content = document.content ?? document.raw;
  const containerTag = (document.containerTags ?? [])[0];
  return {
    content,
    ...(containerTag ? { containerTag } : {}),
    taskType: document.taskType ?? "memory",
    metadata: {
      ...(document.metadata && typeof document.metadata === "object" ? document.metadata : {}),
      smctlReplay: true,
      smctlReplayFrom: originalId,
      smctlReplayAt: new Date().toISOString()
    }
  };
}

function formatMemoryDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness memory doctor");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Sample: ${result.documents.sampled} documents`);
  lines.push(`Statuses: ${Object.entries(result.documents.statusCounts).map(([key, value]) => `${key}:${value}`).join(", ") || "none"}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) {
      lines.push(`   ${check.detail}`);
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
    ? "Result: sampled memory health looks usable."
    : "Result: memory health needs attention.");
  return lines.join("\n");
}

function formatMemoryReplay(result) {
  const lines = [];
  lines.push("Supermemory Harness memory replay");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Mode: ${result.apply ? "apply" : "dry-run"}`);
  lines.push(`Sample: ${result.sampled} documents`);
  lines.push(`Summary: ${result.summary.replayed} replayed, ${result.summary.planned} planned, ${result.summary.skipped} skipped, ${result.summary.failed} failed`);
  lines.push("");

  if (result.actions.length === 0) {
    lines.push("No failed documents found in sample.");
  } else {
    for (const action of result.actions) {
      lines.push(`${symbolReplay(action.status)} ${action.id}  ${action.title}`);
      if (action.detail) lines.push(`   ${action.detail}`);
    }
  }

  lines.push("");
  if (!result.apply && result.summary.planned > 0) {
    lines.push("Result: dry-run complete. Run with --apply after fixing provider/config issues.");
  } else if (result.exitCode === 0) {
    lines.push("Result: replay completed.");
  } else {
    lines.push("Result: replay needs attention.");
  }
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
      body: text ? JSON.parse(text) : null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: formatFetchError(error)
    };
  }
}

async function recentFailureHints(home) {
  try {
    const content = await readFile(join(home, ".supermemory", "server.log"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /memory agent failed|0 memories|Permanently failed/i.test(line))
      .slice(-10);
  } catch {
    return [];
  }
}

function findDuplicateTitles(documents) {
  const counts = new Map();
  for (const doc of documents) {
    const title = normalizeTitle(doc.title);
    if (!title) continue;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count);
}

function documentSummary(doc) {
  return {
    id: doc.id,
    status: doc.status,
    title: doc.title ?? doc.customId ?? "(untitled)",
    containerTags: doc.containerTags ?? []
  };
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeTitle(title) {
  return typeof title === "string" ? title.trim().toLowerCase() : "";
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}

function summarizeReplay(actions) {
  return actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, { replayed: 0, planned: 0, skipped: 0, failed: 0 });
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

function symbolReplay(status) {
  if (["replayed", "planned"].includes(status)) return status === "planned" ? "[plan]" : "[ok]";
  if (status === "skipped") return "[skip]";
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
