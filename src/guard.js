import { createServer } from "node:http";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { applyProjectToRequest, readProjectProfile } from "./project.js";
import { applySkillsetToRequest, readActiveSkillset } from "./skillset.js";

const WRITE_ROUTES = new Set(["POST /v3/documents"]);
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function runGuard(options = {}) {
  const context = guardContext(options);
  const action = options.action ?? "inbox";

  if (action === "start") {
    return startGuard(context);
  }

  if (action === "inbox") {
    return guardInbox(context);
  }

  if (action === "approve") {
    if (!options.id) throw new Error("guard approve requires an id");
    return guardApprove(context, options.id);
  }

  if (action === "reject") {
    if (!options.id) throw new Error("guard reject requires an id");
    return guardReject(context, options.id);
  }

  throw new Error(`Unknown guard action: ${action}`);
}

export async function createGuardServer(options = {}) {
  const context = guardContext(options);
  await ensureStore(context);

  const server = createServer(async (request, response) => {
    try {
      await handleGuardRequest(context, request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: "guard_error",
        message: error.message
      });
    }
  });

  return { server, context };
}

async function startGuard(context) {
  const { server } = await createGuardServer(context);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(context.port, "127.0.0.1", resolve);
  });

  console.log(`Supermemory Harness Guard listening on http://localhost:${context.port}`);
  console.log(`Upstream Supermemory: ${context.upstream}`);
  console.log("Review writes with: smctl guard inbox");
  return new Promise(() => {});
}

async function handleGuardRequest(context, request, response) {
  const url = new URL(request.url ?? "/", `http://localhost:${context.port}`);
  const routeKey = `${request.method} ${url.pathname}`;

  if (url.pathname.startsWith("/__smctl/")) {
    await handleInternalRoute(context, request, response, url);
    return;
  }

  if (WRITE_ROUTES.has(routeKey)) {
    const bodyText = await readBody(request);
    const body = parseJson(bodyText);
    const item = await quarantineWrite(context, {
      method: request.method,
      path: url.pathname,
      query: url.search,
      headers: safeHeaders(request.headers),
      body,
      rawBody: bodyText
    });

    sendJson(response, 202, {
      id: item.id,
      status: "quarantined",
      guard: {
        status: item.status,
        risk: item.risk.level,
        findings: item.risk.findings
      }
    });
    return;
  }

  await proxyRequest(context, request, response, url);
}

async function handleInternalRoute(context, request, response, url) {
  if (request.method === "GET" && url.pathname === "/__smctl/guard/inbox") {
    sendJson(response, 200, { pending: await readPending(context) });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function guardInbox(context) {
  const pending = await readPending(context);
  const result = {
    command: "guard inbox",
    generatedAt: new Date().toISOString(),
    pending,
    summary: summarizePending(pending),
    exitCode: 0
  };
  result.text = formatInbox(result);
  return result;
}

async function guardApprove(context, id) {
  const pending = await readPending(context);
  const item = pending.find((entry) => entry.id === id);
  if (!item) {
    return guardActionResult("approve", id, "failed", "No pending item found", 1);
  }

  const response = await forwardStoredWrite(context, item);
  if (!response.ok) {
    return guardActionResult("approve", id, "failed", response.detail, 1);
  }

  await writePending(context, pending.filter((entry) => entry.id !== id));
  await appendHistory(context, {
    ...item,
    status: "approved",
    approvedAt: new Date().toISOString(),
    upstreamResponse: response.body
  });

  return guardActionResult("approve", id, "approved", `Forwarded to upstream: ${JSON.stringify(response.body)}`, 0);
}

async function guardReject(context, id) {
  const pending = await readPending(context);
  const item = pending.find((entry) => entry.id === id);
  if (!item) {
    return guardActionResult("reject", id, "failed", "No pending item found", 1);
  }

  await writePending(context, pending.filter((entry) => entry.id !== id));
  await appendHistory(context, {
    ...item,
    status: "rejected",
    rejectedAt: new Date().toISOString()
  });

  return guardActionResult("reject", id, "rejected", "Removed from pending inbox", 0);
}

export async function quarantineWrite(context, request) {
  const pending = await readPending(context);
  const project = await readProjectProfile(context.home);
  const skillset = await readActiveSkillset(context.home);
  const skillsetResult = applySkillsetToRequest(skillset, request);
  const projectResult = applyProjectToRequest(project, request);
  const body = applyContextMetadata(request.body, skillsetResult, projectResult);
  const item = {
    id: `guard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    route: `${request.method} ${request.path}`,
    request: {
      ...request,
      body,
      rawBody: JSON.stringify(body)
    },
    preview: previewRequest(request),
    skillset: skillset ? {
      name: skillset.name,
      title: skillset.title,
      metadata: skillsetResult.metadata,
      containerTag: skillsetResult.containerTag
    } : null,
    project: project ? {
      name: project.name,
      root: project.root,
      containerTag: project.containerTag,
      metadata: projectResult.metadata
    } : null,
    risk: mergeRisk(scanRisk(request), skillsetResult.findings)
  };
  pending.push(item);
  await writePending(context, pending);
  return item;
}

function applyContextMetadata(body, skillsetResult, projectResult) {
  return {
    ...body,
    ...(projectResult.containerTag || skillsetResult.containerTag ? { containerTag: projectResult.containerTag ?? skillsetResult.containerTag } : {}),
    metadata: {
      ...(body?.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      ...(projectResult.metadata ?? {}),
      ...(skillsetResult.metadata ?? {})
    }
  };
}

function mergeRisk(baseRisk, findings) {
  const mergedFindings = [...baseRisk.findings, ...findings];
  return {
    level: mergedFindings.some((finding) => finding.severity === "high")
      ? "high"
      : mergedFindings.length > 0 ? "medium" : "low",
    findings: mergedFindings
  };
}

async function forwardStoredWrite(context, item) {
  if (!context.fetch) {
    return { ok: false, detail: "Fetch API unavailable; Node 22+ is required" };
  }

  const target = `${context.upstream}${item.request.path}${item.request.query ?? ""}`;
  try {
    const response = await context.fetch(target, {
      method: item.request.method,
      headers: {
        "content-type": "application/json"
      },
      body: item.request.rawBody || JSON.stringify(item.request.body ?? {})
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null,
      detail: `HTTP ${response.status}: ${text}`
    };
  } catch (error) {
    return {
      ok: false,
      detail: formatFetchError(error)
    };
  }
}

async function proxyRequest(context, request, response, url) {
  if (!context.fetch) {
    sendJson(response, 500, { error: "fetch_unavailable" });
    return;
  }

  const body = ["GET", "HEAD"].includes(request.method ?? "") ? undefined : await readBody(request);
  const upstreamResponse = await context.fetch(`${context.upstream}${url.pathname}${url.search}`, {
    method: request.method,
    headers: safeHeaders(request.headers),
    body
  });
  const text = await upstreamResponse.text();
  response.writeHead(upstreamResponse.status, {
    "content-type": upstreamResponse.headers.get("content-type") ?? "application/octet-stream"
  });
  response.end(text);
}

function scanRisk(request) {
  const findings = [];
  const text = JSON.stringify(request.body ?? {});

  const secretPatterns = [
    ["OpenAI key", /sk-[A-Za-z0-9_-]{20,}/],
    ["Supermemory key", /sm_[A-Za-z0-9_-]{40,}/],
    ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{30,}/],
    ["AWS access key", /AKIA[0-9A-Z]{16}/],
    ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
  ];

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) {
      findings.push({ severity: "high", type: "secret", message: `${label} pattern detected` });
    }
  }

  const injectionPatterns = [
    /ignore (all )?(previous|above) instructions/i,
    /disregard (all )?(previous|above) instructions/i,
    /you are now/i,
    /system prompt/i,
    /developer message/i,
    /remember (that )?.*(trusted|always|never)/i
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(text)) {
      findings.push({ severity: "medium", type: "prompt-injection", message: "Instruction-like memory content detected" });
      break;
    }
  }

  return {
    level: findings.some((finding) => finding.severity === "high")
      ? "high"
      : findings.length > 0 ? "medium" : "low",
    findings
  };
}

function previewRequest(request) {
  const content = request.body?.content ?? "";
  return {
    content: typeof content === "string" ? truncate(content, 180) : "",
    containerTag: request.body?.containerTag,
    customId: request.body?.customId
  };
}

async function readPending(context) {
  await ensureStore(context);
  if (!await exists(context.pendingPath)) return [];
  const content = await readFile(context.pendingPath, "utf8");
  if (!content.trim()) return [];
  return JSON.parse(content);
}

async function writePending(context, pending) {
  await ensureStore(context);
  const tmpPath = `${context.pendingPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(pending, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, context.pendingPath);
}

async function appendHistory(context, item) {
  await ensureStore(context);
  const history = await readHistory(context);
  history.push(item);
  await writeFile(context.historyPath, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
}

async function readHistory(context) {
  if (!await exists(context.historyPath)) return [];
  const content = await readFile(context.historyPath, "utf8");
  return content.trim() ? JSON.parse(content) : [];
}

async function ensureStore(context) {
  await mkdir(dirname(context.pendingPath), { recursive: true });
}

export function guardContext(options) {
  const home = options.home ?? homedir();
  const storeDir = options.storeDir ?? join(home, ".config", "smctl", "guard");
  return {
    home,
    port: options.port ?? 6777,
    upstream: normalizeBaseUrl(options.upstream ?? "http://localhost:6767"),
    fetch: options.fetch ?? globalThis.fetch,
    pendingPath: join(storeDir, "pending.json"),
    historyPath: join(storeDir, "history.json")
  };
}

function formatInbox(result) {
  const lines = [];
  lines.push("Supermemory Harness guard inbox");
  lines.push(`Pending: ${result.pending.length}`);
  lines.push("");

  if (result.pending.length === 0) {
    lines.push("No pending memory writes.");
  } else {
    for (const item of result.pending) {
      lines.push(`${item.id}  ${item.risk.level}  ${item.route}`);
      lines.push(`   ${item.preview.content || "(no text preview)"}`);
      if (item.risk.findings.length > 0) {
        for (const finding of item.risk.findings) {
          lines.push(`   ${finding.severity}: ${finding.message}`);
        }
      }
      if (item.skillset) {
        lines.push(`   skillset: ${item.skillset.name}`);
      }
      if (item.project) {
        lines.push(`   project: ${item.project.name}`);
      }
    }
  }

  return lines.join("\n");
}

function guardActionResult(action, id, status, detail, exitCode) {
  const result = {
    command: `guard ${action}`,
    generatedAt: new Date().toISOString(),
    id,
    status,
    detail,
    exitCode
  };
  result.text = [
    `Supermemory Harness guard ${action}`,
    `ID: ${id}`,
    `Status: ${status}`,
    detail
  ].join("\n");
  return result;
}

function summarizePending(pending) {
  return pending.reduce((acc, item) => {
    acc.total += 1;
    acc[item.risk.level] = (acc[item.risk.level] ?? 0) + 1;
    return acc;
  }, { total: 0, low: 0, medium: 0, high: 0 });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Expected JSON request body");
  }
}

function safeHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    if (["host", "content-length", "connection"].includes(key.toLowerCase())) continue;
    output[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return output;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) {
    return `${error.message}: ${cause.code}`;
  }
  return error.message;
}
