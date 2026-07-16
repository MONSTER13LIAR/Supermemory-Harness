import { homedir } from "node:os";
import { runDoctor } from "./doctor.js";
import { runGuard } from "./guard.js";
import { repairWatchdog } from "./repair.js";

export async function runWatch(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 12
  };

  const doctor = await runDoctor({
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch
  });
  const guard = await runGuard({
    action: "inbox",
    home: context.home,
    fetch: context.fetch
  });

  const canReadMemory = doctor.server.reachable && context.fetch;
  const documentsResult = canReadMemory
    ? await listDocuments(context)
    : unavailableResult("Supermemory Local is not reachable");
  const processingResult = canReadMemory
    ? await getProcessing(context)
    : unavailableResult("Supermemory Local is not reachable");
  const watchdog = canReadMemory
    ? await repairWatchdog({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })
    : null;

  const documents = documentsResult.documents;
  const documentCounts = countBy(documents, (doc) => doc.status ?? "unknown");
  const queued = countStatuses(documentCounts, ["queued", "processing"]);
  const failed = countStatuses(documentCounts, ["failed", "error"]);
  const agents = summarizeAgents(doctor.tools);
  const guardRisk = summarizeGuardRisk(guard.pending);
  const dreaming = summarizeDreaming(processingResult.body, queued);
  const warnings = countWarnings({
    doctor,
    documentsResult,
    processingResult,
    failed,
    queued,
    guardRisk,
    watchdog
  });
  const localStatus = doctor.server.reachable ? "online" : "offline";
  const mcpStatus = mcpState(doctor.server.mcpStatus);
  const bar = [
    `Local: ${localStatus}`,
    `MCP: ${mcpStatus.label}`,
    `Agents: ${agents.configured}/${agents.total}`,
    `Writes: ${documents.length}`,
    `Queue: ${queued}`,
    `Dreaming: ${dreaming.label}`,
    `Guard: ${guard.pending.length}`,
    `Warnings: ${warnings}`
  ];

  const result = {
    command: "watch",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    bar,
    local: {
      status: localStatus,
      dashboardStatus: doctor.server.dashboardStatus,
      openApiStatus: doctor.server.openApiStatus,
      mcpStatus: doctor.server.mcpStatus,
      mcp: mcpStatus,
      summary: doctor.summary
    },
    agents,
    memory: {
      sampled: documents.length,
      counts: documentCounts,
      queued,
      failed,
      processing: processingResult.ok ? processingResult.body : null,
      processingDetail: processingResult.ok ? summarizeObject(processingResult.body) : processingResult.detail,
      dreaming
    },
    guard: {
      pending: guard.pending.length,
      risk: guardRisk,
      recent: guard.pending.slice(0, 5).map((item) => ({
        id: item.id,
        risk: item.risk.level,
        route: item.route,
        preview: item.preview.content
      }))
    },
    watchdog: watchdog ? {
      status: watchdog.status,
      detail: watchdog.detail
    } : null,
    recentEvents: documents.slice(0, 8).map(documentEvent),
    next: nextCommand({
      doctor,
      documentsResult,
      failed,
      queued,
      guard,
      watchdog
    }),
    exitCode: doctor.exitCode === 0 ? 0 : 1
  };
  result.text = formatWatch(result);
  return result;
}

async function listDocuments(context) {
  const response = await requestJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      limit: context.limit,
      page: 1,
      sort: "createdAt",
      order: "desc"
    })
  });
  return {
    ...response,
    documents: response.ok ? response.body?.memories ?? response.body?.documents ?? [] : []
  };
}

async function getProcessing(context) {
  return requestJson(context.fetch, `${context.baseUrl}/v3/documents/processing`, {
    method: "GET"
  });
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
      detail: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      detail: formatFetchError(error)
    };
  }
}

function formatWatch(result) {
  const lines = [];
  lines.push("Supermemory Harness Bar");
  lines.push(result.bar.join(" | "));
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");

  lines.push("[local]");
  lines.push(`   Supermemory Local is ${result.local.status}. Dashboard: ${result.local.dashboardStatus ?? "unreachable"}, OpenAPI: ${result.local.openApiStatus ?? "unreachable"}, MCP: ${result.local.mcpStatus ?? "unreachable"}`);
  lines.push(`   MCP: ${result.local.mcp.detail}`);
  lines.push(`   Doctor: ${result.local.summary.ok} ok, ${result.local.summary.warn} warn, ${result.local.summary.fail} fail`);
  lines.push("");

  lines.push("[agents]");
  lines.push(`   Installed: ${result.agents.installed}/${result.agents.total}; configured: ${result.agents.configured}/${result.agents.total}`);
  if (result.agents.active.length > 0) {
    lines.push(`   Active configs: ${result.agents.active.join(", ")}`);
  } else {
    lines.push("   Active configs: none detected");
  }
  lines.push("");

  lines.push("[memory flow]");
  lines.push(`   Sampled writes: ${result.memory.sampled}; statuses: ${formatCounts(result.memory.counts)}`);
  lines.push(`   Queue: ${result.memory.queued}; failed: ${result.memory.failed}; processing: ${result.memory.processingDetail}`);
  lines.push(`   Dreaming: ${result.memory.dreaming.detail}`);
  lines.push("");

  lines.push("[guard]");
  lines.push(`   Pending writes: ${result.guard.pending}; risk: ${result.guard.risk.low} low, ${result.guard.risk.medium} medium, ${result.guard.risk.high} high`);
  for (const item of result.guard.recent) {
    lines.push(`   ${item.id}  ${item.risk}  ${item.preview || item.route}`);
  }
  lines.push("");

  lines.push("[recent events]");
  if (result.recentEvents.length === 0) {
    lines.push("   No recent Supermemory documents sampled.");
  } else {
    for (const event of result.recentEvents) {
      lines.push(`   ${event.status.padEnd(10)} ${event.container.padEnd(20)} ${event.title}`);
    }
  }
  lines.push("");

  if (result.watchdog) {
    lines.push(`[watchdog] ${result.watchdog.status}: ${result.watchdog.detail}`);
  }
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function nextCommand({ doctor, documentsResult, failed, queued, guard, watchdog }) {
  if (doctor.exitCode !== 0) return "smctl doctor";
  if (!documentsResult.ok) return "smctl memory doctor";
  if (guard.pending.some((item) => item.risk.level === "high")) return "smctl guard inbox";
  if (failed > 0 || watchdog?.status !== "ok") return "smctl repair";
  if (queued > 0 || guard.pending.length > 0) return guard.pending.length > 0 ? "smctl guard inbox" : "smctl memory doctor";
  return "smctl verify";
}

function summarizeAgents(tools) {
  const entries = Object.entries(tools ?? {});
  const installed = entries.filter(([, tool]) => tool.installed).length;
  const configured = entries.filter(([, tool]) => tool.configured).length;
  return {
    total: entries.length,
    installed,
    configured,
    active: entries.filter(([, tool]) => tool.configured).map(([name]) => name)
  };
}

function summarizeGuardRisk(pending) {
  return pending.reduce((acc, item) => {
    const level = item.risk?.level ?? "low";
    acc[level] = (acc[level] ?? 0) + 1;
    return acc;
  }, { low: 0, medium: 0, high: 0 });
}

function summarizeDreaming(processing, queuedDocuments) {
  if (!processing || typeof processing !== "object") {
    return {
      label: queuedDocuments > 0 ? "likely" : "unknown",
      detail: queuedDocuments > 0
        ? "Queued or processing documents exist; consolidation may still be catching up."
        : "Processing endpoint unavailable, so dreaming state cannot be confirmed."
    };
  }

  const running = Number(processing.running ?? processing.active ?? 0);
  const queued = Number(processing.queued ?? processing.pending ?? queuedDocuments);
  if (running > 0 || queued > 0 || queuedDocuments > 0) {
    return {
      label: "active",
      detail: `Processing backlog visible: running:${running || 0}, queued:${queued || queuedDocuments || 0}`
    };
  }

  return {
    label: "idle",
    detail: "No active processing backlog detected from the sampled endpoints."
  };
}

function mcpState(status) {
  if (status === 405) {
    return { label: "ready", detail: "/mcp is reachable and rejected this probe method, which still proves the route exists." };
  }
  if (typeof status === "number" && status >= 200 && status < 400) {
    return { label: "ready", detail: `/mcp returned HTTP ${status}.` };
  }
  if (status === 404) {
    return { label: "missing", detail: "/mcp returned 404; run supermemory-server upgrade, restart with smctl supermemory start, then re-run smctl doctor." };
  }
  if (status == null) {
    return { label: "offline", detail: "/mcp could not be probed because Supermemory Local is unreachable." };
  }
  return { label: "check", detail: `/mcp returned HTTP ${status}; verify the local server version and MCP config.` };
}

function countWarnings({ doctor, documentsResult, processingResult, failed, queued, guardRisk, watchdog }) {
  let total = doctor.summary.warn + doctor.summary.fail;
  if (!documentsResult.ok) total += 1;
  if (!processingResult.ok) total += 1;
  if (failed > 0) total += failed;
  if (queued > 0) total += 1;
  total += guardRisk.medium + guardRisk.high;
  if (watchdog && watchdog.status !== "ok") total += 1;
  return total;
}

function documentEvent(doc) {
  return {
    status: doc.status ?? "unknown",
    container: firstContainer(doc),
    title: truncate(doc.title ?? doc.customId ?? doc.id ?? "(untitled)", 72)
  };
}

function firstContainer(doc) {
  if (Array.isArray(doc.containerTags) && doc.containerTags.length > 0) return doc.containerTags[0];
  if (doc.containerTag) return doc.containerTag;
  return "no-container";
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function countStatuses(counts, statuses) {
  return statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}:${value}`).join(", ") : "none";
}

function summarizeObject(value) {
  if (!value || typeof value !== "object") return "unavailable";
  const entries = Object.entries(value).slice(0, 5);
  return entries.length > 0 ? entries.map(([key, val]) => `${key}:${val}`).join(", ") : "reachable";
}

function unavailableResult(detail) {
  return {
    ok: false,
    status: null,
    body: null,
    detail,
    documents: []
  };
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
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
