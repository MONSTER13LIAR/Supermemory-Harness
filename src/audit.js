import { homedir } from "node:os";
import { normalizeBaseUrl } from "./insights.js";
import { readProjectProfile } from "./project.js";

export async function runAudit(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 50
  };
  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");

  const [profile, openapi, inventory, processing] = await Promise.all([
    readProjectProfile(context.home),
    getJson(context.fetch, `${context.baseUrl}/v4/openapi`),
    collectDocuments(context),
    getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`)
  ]);

  const checks = buildAuditChecks({ profile, openapi, inventory, processing });
  const summary = summarize(checks);
  const result = {
    command: "audit",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    sampled: inventory.documents.length,
    profile,
    checks,
    summary,
    next: nextSteps(checks),
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatAudit(result);
  return result;
}

async function collectDocuments(context) {
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const sampled = list.body?.memories ?? list.body?.documents ?? [];
  const documents = [];
  for (const doc of sampled) {
    if (!doc.id) {
      documents.push(doc);
      continue;
    }
    const detail = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${doc.id}`);
    documents.push(detail.ok && detail.body ? { ...doc, ...detail.body } : doc);
  }
  return {
    ok: list.ok,
    detail: responseDetail(list),
    documents
  };
}

function buildAuditChecks({ profile, openapi, inventory, processing }) {
  if (!inventory.ok) {
    return [fail("Local document inventory", inventory.detail, "smctl doctor")];
  }
  const docs = inventory.documents;
  return [
    customIdCheck(docs),
    projectScopeCheck(docs, profile),
    sourceAnchorCheck(docs),
    processingCheck(docs, processing),
    retrievalRouteCheck(openapi)
  ];
}

function customIdCheck(documents) {
  const done = documents.filter((doc) => !doc.status || doc.status === "done");
  const missing = done.filter((doc) => !doc.customId && !metadata(doc).customId && !metadata(doc).smctlContentHash);
  const duplicates = duplicateValues(done.map((doc) => doc.customId ?? metadata(doc).customId).filter(Boolean));
  if (done.length === 0) return warn("Duplicate prevention", "No completed documents sampled yet.", "smctl verify");
  if (duplicates.length > 0) {
    return fail("Duplicate prevention", `${duplicates.length} duplicate customId value(s) found.`, "smctl cleanup");
  }
  if (missing.length > Math.ceil(done.length * 0.5)) {
    return warn("Duplicate prevention", `${missing.length}/${done.length} completed document(s) lack customId or migration hash.`, "Use customId for repeatable imports.");
  }
  return ok("Duplicate prevention", `${done.length - missing.length}/${done.length} completed document(s) have a stable import identity.`);
}

function projectScopeCheck(documents, profile) {
  const done = documents.filter((doc) => !doc.status || doc.status === "done");
  if (!profile?.containerTag) {
    return warn("Project scoping", "No active Harness project profile.", "smctl init");
  }
  const missing = done.filter((doc) => !(doc.containerTags ?? []).includes(profile.containerTag) && metadata(doc).smctlProject !== profile.name);
  if (missing.length > 0) {
    return warn("Project scoping", `${missing.length}/${done.length} completed document(s) are outside ${profile.containerTag}.`, "smctl start");
  }
  return ok("Project scoping", `Sampled completed documents are scoped to ${profile.containerTag}.`);
}

function sourceAnchorCheck(documents) {
  const done = documents.filter((doc) => !doc.status || doc.status === "done");
  const anchored = done.filter(hasSourceAnchor);
  if (done.length === 0) return warn("Source grounding", "No completed documents sampled yet.", "smctl verify");
  if (anchored.length === 0) {
    return warn("Source grounding", "No completed sampled documents have URL, filepath, source, or migration local ID.", "smctl memory coach");
  }
  if (anchored.length < Math.ceil(done.length * 0.5)) {
    return warn("Source grounding", `${anchored.length}/${done.length} completed document(s) have source anchors.`, "smctl memory coach");
  }
  return ok("Source grounding", `${anchored.length}/${done.length} completed document(s) have source anchors.`);
}

function processingCheck(documents, processing) {
  const failed = documents.filter((doc) => ["failed", "error"].includes(doc.status));
  const queued = documents.filter((doc) => ["queued", "processing"].includes(doc.status));
  const body = processing.body && typeof processing.body === "object" ? processing.body : {};
  const running = Number(body.running ?? body.active ?? 0);
  const remoteQueued = Number(body.queued ?? body.pending ?? body.totalCount ?? 0);
  if (failed.length > 0) {
    return fail("Processing queue", `${failed.length} failed document(s) in sample.`, "smctl repair wizard");
  }
  if (queued.length > 0 || running > 0 || remoteQueued > 0) {
    return warn("Processing queue", `queued ${Math.max(queued.length, remoteQueued)}, running ${running}.`, "smctl watch");
  }
  return ok("Processing queue", "No failed or queued documents in the sampled state.");
}

function retrievalRouteCheck(openapi) {
  const paths = openapi.body?.paths ?? {};
  const hasV3 = Boolean(paths["/v3/search"]);
  const hasV4 = Boolean(paths["/v4/search"] || paths["/v4/memories/list"]);
  if (!openapi.ok) {
    return fail("Retrieval readiness", responseDetail(openapi), "smctl doctor");
  }
  if (!hasV3 && !hasV4) {
    return fail("Retrieval readiness", "Search routes are missing from /v4/openapi.", "smctl doctor");
  }
  if (!hasV4) {
    return warn("Retrieval readiness", "v3 search exists, but v4 memory search/list route was not found.", "smctl verify");
  }
  return ok("Retrieval readiness", "Search and memory routes are visible in OpenAPI.");
}

function nextSteps(checks) {
  const commands = [];
  for (const check of checks) {
    if (check.command && !commands.includes(check.command)) commands.push(check.command);
  }
  if (commands.length === 0) commands.push("smctl trust --probe");
  return commands.slice(0, 5);
}

function formatAudit(result) {
  const lines = [];
  lines.push("Supermemory Harness memory hygiene audit");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Sampled: ${result.sampled} documents`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  if (result.profile) lines.push(`Project: ${result.profile.name} -> ${result.profile.containerTag}`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    lines.push(`   ${check.detail}`);
    if (check.command) lines.push(`   Next: ${check.command}`);
  }
  lines.push("");
  lines.push("Recommended:");
  for (const command of result.next) lines.push(`   ${command}`);
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: memory hygiene is usable in this sample."
    : "Result: fix failing audit checks before relying on memory.");
  return lines.join("\n");
}

function metadata(doc) {
  return doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
}

function hasSourceAnchor(doc) {
  const meta = metadata(doc);
  return Boolean(
    doc.url
    || doc.filepath
    || (doc.source && doc.source !== "supermemory-local")
    || meta.url
    || meta.filepath
    || meta.source
    || meta.smctlLocalId
  );
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}

function ok(title, detail, command) {
  return { status: "ok", title, detail, command };
}

function warn(title, detail, command) {
  return { status: "warn", title, detail, command };
}

function fail(title, detail, command) {
  return { status: "fail", title, detail, command };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
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
      signal: AbortSignal.timeout(8000)
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
      error: error.message
    };
  }
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (!response.status) return "request failed";
  const body = response.body ? JSON.stringify(response.body).slice(0, 240) : "";
  return `HTTP ${response.status}${body ? `: ${body}` : ""}`;
}
