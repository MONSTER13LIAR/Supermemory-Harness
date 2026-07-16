import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export async function runDreams(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 50,
    dryRun: Boolean(options.dryRun),
    now: options.now ?? new Date().toISOString()
  };
  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");

  const previous = await readSnapshot(context.home);
  const current = await collectDreamState(context);
  const diff = diffSnapshots(previous, current);
  const result = {
    command: "dreams",
    generatedAt: context.now,
    baseUrl: context.baseUrl,
    dryRun: context.dryRun,
    previous: previous ? { generatedAt: previous.generatedAt, sampled: previous.documents.length } : null,
    current: { sampled: current.documents.length, processing: current.processing },
    diff,
    state: inferDreamState(current, diff),
    next: nextCommand(current, diff),
    exitCode: current.ok ? 0 : 1
  };

  if (!context.dryRun && current.ok) {
    await writeSnapshot(context.home, current);
  }

  result.text = formatDreams(result);
  return result;
}

async function collectDreamState(context) {
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const processing = await getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`);
  const documents = list.ok
    ? (list.body?.memories ?? list.body?.documents ?? []).map(documentSnapshot)
    : [];
  return {
    generatedAt: context.now,
    ok: list.ok,
    listDetail: responseDetail(list),
    processing: processing.ok ? processing.body : null,
    processingDetail: responseDetail(processing),
    documents
  };
}

function documentSnapshot(doc) {
  return {
    id: doc.id,
    status: doc.status ?? "unknown",
    title: doc.title ?? doc.customId ?? "(untitled)",
    containerTags: doc.containerTags ?? (doc.containerTag ? [doc.containerTag] : []),
    updatedAt: doc.updatedAt ?? doc.createdAt ?? null
  };
}

function diffSnapshots(previous, current) {
  if (!previous) {
    return {
      firstRun: true,
      newDocuments: current.documents,
      completed: [],
      failed: [],
      disappeared: [],
      changed: []
    };
  }
  const before = new Map(previous.documents.map((doc) => [doc.id, doc]));
  const after = new Map(current.documents.map((doc) => [doc.id, doc]));
  const changed = [];
  const completed = [];
  const failed = [];
  const newDocuments = [];
  const disappeared = [];

  for (const doc of current.documents) {
    const old = before.get(doc.id);
    if (!old) {
      newDocuments.push(doc);
      if (["failed", "error"].includes(doc.status)) {
        failed.push({ id: doc.id, title: doc.title, from: "new", to: doc.status, containerTags: doc.containerTags });
      }
      continue;
    }
    if (old.status !== doc.status) {
      const change = { id: doc.id, title: doc.title, from: old.status, to: doc.status, containerTags: doc.containerTags };
      changed.push(change);
      if (doc.status === "done") completed.push(change);
      if (["failed", "error"].includes(doc.status)) failed.push(change);
    }
  }

  for (const doc of previous.documents) {
    if (!after.has(doc.id)) disappeared.push(doc);
  }

  return { firstRun: false, newDocuments, completed, failed, disappeared, changed };
}

function inferDreamState(current, diff) {
  if (!current.ok) {
    return { label: "unavailable", detail: current.listDetail };
  }
  const processing = current.processing && typeof current.processing === "object" ? current.processing : {};
  const queued = Number(processing.queued ?? processing.pending ?? processing.totalCount ?? 0);
  const running = Number(processing.running ?? processing.active ?? 0);
  const changed = diff.completed.length + diff.failed.length + diff.disappeared.length;
  if (running > 0 || queued > 0) {
    return { label: "active", detail: `processing visible: running ${running}, queued ${queued}` };
  }
  if (changed > 0) {
    return { label: "settled", detail: `${changed} change(s) since last snapshot` };
  }
  return { label: "idle", detail: "no processing backlog or state changes detected" };
}

function nextCommand(current, diff) {
  if (!current.ok) return "smctl doctor";
  if (diff.failed.length > 0) return "smctl repair wizard";
  if (diff.completed.length > 0 || diff.disappeared.length > 0) return "smctl trust";
  return "smctl watch";
}

function formatDreams(result) {
  const lines = [];
  lines.push("Supermemory Harness Dream Flight Recorder");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`State: ${result.state.label} - ${result.state.detail}`);
  lines.push(`Sampled: ${result.current.sampled}`);
  lines.push(result.previous ? `Previous: ${result.previous.sampled} at ${result.previous.generatedAt}` : "Previous: none");
  lines.push("");
  lines.push(`New: ${result.diff.newDocuments.length}`);
  lines.push(`Completed: ${result.diff.completed.length}`);
  lines.push(`Failed: ${result.diff.failed.length}`);
  lines.push(`Disappeared: ${result.diff.disappeared.length}`);
  if (result.diff.changed.length > 0) {
    lines.push("");
    lines.push("Changes:");
    for (const change of result.diff.changed.slice(0, 8)) {
      lines.push(`   ${change.from} -> ${change.to}  ${change.title}`);
    }
  }
  lines.push("");
  lines.push(result.dryRun ? "Snapshot: dry-run, not saved" : "Snapshot: saved for next comparison");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

async function readSnapshot(home) {
  try {
    return JSON.parse(await readFile(snapshotPath(home), "utf8"));
  } catch {
    return null;
  }
}

async function writeSnapshot(home, snapshot) {
  const path = snapshotPath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
}

function snapshotPath(home) {
  return join(home, ".config", "smctl", "dream-flight.json");
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

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) return `${error.message}: ${cause.code}`;
  return error.message;
}
