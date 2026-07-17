import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { attachSmartSections } from "./smart-sections.js";

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
  return attachSmartSections(result, options);
}

async function collectDreamState(context) {
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const processing = await getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`);
  const sampled = list.ok ? (list.body?.memories ?? list.body?.documents ?? []) : [];
  const documents = [];
  for (const doc of sampled) {
    let detail = null;
    if (doc.id) {
      const response = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${doc.id}`);
      if (response.ok && response.body) detail = response.body;
    }
    documents.push(documentSnapshot(detail ? { ...doc, ...detail } : doc));
  }
  return {
    generatedAt: context.now,
    ok: list.ok,
    limit: context.limit,
    listDetail: responseDetail(list),
    processing: processing.ok ? processing.body : null,
    processingDetail: responseDetail(processing),
    documents
  };
}

function documentSnapshot(doc) {
  const content = extractContent(doc);
  return {
    id: doc.id,
    status: doc.status ?? "unknown",
    title: doc.title ?? doc.customId ?? "(untitled)",
    containerTags: doc.containerTags ?? (doc.containerTag ? [doc.containerTag] : []),
    updatedAt: doc.updatedAt ?? doc.createdAt ?? null,
    contentHash: hashText(content),
    contentLength: content.length,
    sourceAnchors: sourceAnchors(doc)
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
      changed: [],
      contentChanged: [],
      titleChanged: [],
      containerChanged: [],
      anchorChanged: [],
      highRisk: []
    };
  }
  const before = new Map(previous.documents.map((doc) => [doc.id, doc]));
  const after = new Map(current.documents.map((doc) => [doc.id, doc]));
  const changed = [];
  const completed = [];
  const failed = [];
  const newDocuments = [];
  const disappeared = [];
  const contentChanged = [];
  const titleChanged = [];
  const containerChanged = [];
  const anchorChanged = [];

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
    if (old.contentHash && doc.contentHash && old.contentHash !== doc.contentHash) {
      const change = { id: doc.id, title: doc.title, from: old.contentHash, to: doc.contentHash, containerTags: doc.containerTags };
      contentChanged.push(change);
      changed.push({ ...change, kind: "content" });
    }
    if (old.title !== doc.title) {
      const change = { id: doc.id, title: doc.title, from: old.title, to: doc.title, containerTags: doc.containerTags };
      titleChanged.push(change);
      changed.push({ ...change, kind: "title" });
    }
    if (JSON.stringify(old.containerTags ?? []) !== JSON.stringify(doc.containerTags ?? [])) {
      const change = { id: doc.id, title: doc.title, from: (old.containerTags ?? []).join(","), to: (doc.containerTags ?? []).join(","), containerTags: doc.containerTags };
      containerChanged.push(change);
      changed.push({ ...change, kind: "container" });
    }
    if (JSON.stringify(old.sourceAnchors ?? []) !== JSON.stringify(doc.sourceAnchors ?? [])) {
      const change = { id: doc.id, title: doc.title, from: (old.sourceAnchors ?? []).join(","), to: (doc.sourceAnchors ?? []).join(","), containerTags: doc.containerTags };
      anchorChanged.push(change);
      changed.push({ ...change, kind: "anchors" });
    }
  }

  const comparableWindow = current.documents.length >= previous.documents.length || previous.limit === current.limit;
  if (comparableWindow) {
    for (const doc of previous.documents) {
      if (!after.has(doc.id)) disappeared.push(doc);
    }
  }

  return {
    firstRun: false,
    newDocuments,
    completed,
    failed,
    disappeared,
    changed,
    contentChanged,
    titleChanged,
    containerChanged,
    anchorChanged,
    highRisk: highRiskDreamChanges({ contentChanged, titleChanged, containerChanged, disappeared })
  };
}

function inferDreamState(current, diff) {
  if (!current.ok) {
    return { label: "unavailable", detail: current.listDetail };
  }
  const processing = current.processing && typeof current.processing === "object" ? current.processing : {};
  const queued = Number(processing.queued ?? processing.pending ?? processing.totalCount ?? 0);
  const running = Number(processing.running ?? processing.active ?? 0);
  const changed = diff.completed.length + diff.failed.length + diff.disappeared.length + diff.contentChanged.length + diff.containerChanged.length;
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
  if (diff.highRisk?.length > 0) return "smctl trust";
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
  lines.push(`Content changed: ${result.diff.contentChanged?.length ?? 0}`);
  lines.push(`Container changed: ${result.diff.containerChanged?.length ?? 0}`);
  if ((result.diff.highRisk ?? []).length > 0) {
    lines.push("");
    lines.push("High-risk dream changes:");
    for (const change of result.diff.highRisk.slice(0, 8)) {
      lines.push(`   ${change.kind}  ${change.title}`);
      lines.push(`      ${change.detail}`);
    }
  }
  if (result.diff.changed.length > 0) {
    lines.push("");
    lines.push("Changes:");
    for (const change of result.diff.changed.slice(0, 8)) {
      const prefix = change.kind ? `${change.kind}: ` : "";
      lines.push(`   ${prefix}${change.from} -> ${change.to}  ${change.title}`);
    }
  }
  lines.push("");
  lines.push(result.dryRun ? "Snapshot: dry-run, not saved" : "Snapshot: saved for next comparison");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function highRiskDreamChanges({ contentChanged, titleChanged, containerChanged, disappeared }) {
  const risks = [];
  for (const item of contentChanged) {
    risks.push({
      ...item,
      kind: "content",
      detail: "Stored memory text changed between snapshots; verify recall before relying on this fact."
    });
  }
  for (const item of titleChanged) {
    risks.push({
      ...item,
      kind: "title",
      detail: "Memory title changed between snapshots; check whether a profile/summary rewrite changed meaning."
    });
  }
  for (const item of containerChanged) {
    risks.push({
      ...item,
      kind: "scope",
      detail: "Container tags changed between snapshots; project isolation may have shifted."
    });
  }
  for (const item of disappeared) {
    risks.push({
      ...item,
      kind: "missing",
      detail: "A previously sampled document disappeared; confirm it was intentional or still recallable."
    });
  }
  return risks;
}

function extractContent(doc) {
  return String(doc.content ?? doc.raw ?? doc.memory ?? "").trim();
}

function sourceAnchors(doc) {
  const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
  return [
    doc.url ? "url" : null,
    doc.filepath ? "filepath" : null,
    doc.source && doc.source !== "supermemory-local" ? "source" : null,
    metadata.url ? "metadata.url" : null,
    metadata.filepath ? "metadata.filepath" : null,
    metadata.source ? "metadata.source" : null,
    metadata.smctlLocalId ? "migration.local-id" : null
  ].filter(Boolean);
}

function hashText(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex").slice(0, 16);
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
