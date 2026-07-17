import { createServer } from "node:http";
import { homedir } from "node:os";
import { runGenome } from "./genome.js";
import { analyzeMemory } from "./insights.js";
import { runProject } from "./project.js";
import { runRepair } from "./repair.js";
import { runSetup } from "./setup.js";
import { runTrust } from "./trust.js";
import { runVerify } from "./verify.js";
import { runWatch } from "./watch.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function runUi(options = {}) {
  const context = uiContext(options);
  const { server } = createHarnessUiServer(context);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(context.port, "127.0.0.1", resolve);
  });

  console.log(`Supermemory Harness UI listening on http://localhost:${context.port}`);
  console.log(`Embedding Harness Bar into upstream Supermemory: ${context.upstream}`);
  console.log("Open that URL to use Supermemory with the Harness Bar.");
  return new Promise(() => {});
}

export function createHarnessUiServer(options = {}) {
  const context = uiContext(options);
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(context, request, response);
    } catch (error) {
      sendText(response, 500, `smctl ui error: ${error.message}\n`);
    }
  });
  return { server, context };
}

function uiContext(options) {
  return {
    upstream: normalizeBaseUrl(options.upstream ?? options.baseUrl ?? "http://localhost:6767"),
    port: options.port ?? 6778,
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch
  };
}

async function handleRequest(context, request, response) {
  const url = new URL(request.url ?? "/", `http://localhost:${context.port}`);

  if (request.method === "GET" && url.pathname === "/__smctl/bar") {
    sendJson(response, 200, await embeddedSummary(context));
    return;
  }

  if (request.method === "GET" && url.pathname === "/__smctl/panel") {
    sendJson(response, 200, await embeddedPanel(context));
    return;
  }

  if (request.method === "GET" && url.pathname === "/__smctl/flight") {
    sendJson(response, 200, await safeResult(() => analyzeMemory({
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 100
    })));
    return;
  }

  if (request.method === "GET" && url.pathname === "/__smctl/trust") {
    sendJson(response, 200, await safeResult(() => runTrust({
      baseUrl: context.upstream,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      limit: 50
    })));
    return;
  }

  if (request.method === "GET" && url.pathname === "/__smctl/genome") {
    sendJson(response, 200, await safeResult(() => runGenome({
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 75
    })));
    return;
  }

  if (request.method === "POST" && url.pathname === "/__smctl/genome/apply") {
    sendJson(response, 200, await safeResult(() => runGenome({
      action: "apply",
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 75
    })));
    return;
  }

  if (request.method === "POST" && url.pathname === "/__smctl/trust/probe") {
    sendJson(response, 200, await safeResult(() => runTrust({
      baseUrl: context.upstream,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      limit: 50,
      probe: true,
      timeoutMs: 15000
    })));
    return;
  }

  if (request.method === "POST" && url.pathname === "/__smctl/setup/apply") {
    const setup = await runSetup({
      baseUrl: context.upstream,
      home: context.home,
      target: "all",
      dryRun: false
    });
    sendJson(response, 200, setup);
    return;
  }

  if (request.method === "POST" && url.pathname === "/__smctl/verify") {
    const verify = await runVerify({
      baseUrl: context.upstream,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      timeoutMs: 15000
    });
    sendJson(response, 200, verify);
    return;
  }

  await proxySupermemory(context, request, response, url);
}

async function embeddedSummary(context) {
  const watch = await runWatch({
    baseUrl: context.upstream,
    home: context.home,
    cwd: context.cwd,
    env: context.env,
    fetch: context.fetch,
    limit: 12
  });
  return {
    generatedAt: watch.generatedAt,
    bar: watch.bar,
    local: watch.local,
    agents: watch.agents,
    memory: watch.memory,
    guard: watch.guard,
    watchdog: watch.watchdog,
    recentEvents: watch.recentEvents,
    next: watch.next
  };
}

async function embeddedPanel(context) {
  const [summary, setup, repair, project, analysis, trust, genome] = await Promise.all([
    embeddedSummary(context),
    safeResult(() => runSetup({
      baseUrl: context.upstream,
      home: context.home,
      target: "all",
      dryRun: true
    })),
    safeResult(() => runRepair({
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 25
    })),
    safeResult(() => runProject({
      action: "dashboard",
      baseUrl: context.upstream,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      limit: 25
    })),
    safeResult(() => analyzeMemory({
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 50
    })),
    safeResult(() => runTrust({
      baseUrl: context.upstream,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      limit: 50
    })),
    safeResult(() => runGenome({
      baseUrl: context.upstream,
      home: context.home,
      fetch: context.fetch,
      limit: 75
    }))
  ]);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    setup,
    repair,
    project,
    analysis,
    trust,
    genome,
    journeys: journeySteps({ summary, setup, repair, project, analysis, trust }),
    readiness: readinessModel({ summary, setup, repair, project, analysis, trust })
  };
}

async function safeResult(fn) {
  try {
    return await fn();
  } catch (error) {
    return {
      error: error.message,
      exitCode: 1
    };
  }
}

function journeySteps({ summary, setup, repair, project, analysis, trust }) {
  const steps = [];
  steps.push({
    id: "local",
    title: "Keep Supermemory Local online",
    status: summary.local.status === "online" ? "done" : "blocked",
    detail: summary.local.status === "online" ? "Dashboard and OpenAPI are reachable." : "Start supermemory-server first.",
    command: "smctl supermemory start"
  });

  steps.push({
    id: "setup",
    title: "Connect coding tools",
    status: summary.agents.configured > 0 ? "done" : "todo",
    detail: summary.agents.configured > 0
      ? `${summary.agents.configured} integration config(s) detected.`
      : "Apply local setup, then run the listed installer commands for Codex/Claude/OpenCode.",
    command: "smctl enhance"
  });

  steps.push({
    id: "project",
    title: "Scope memories to the active project",
    status: project?.profile ? "done" : "todo",
    detail: project?.profile ? `${project.profile.name} writes use ${project.profile.containerTag}.` : "Run smctl init from your code project to prevent cross-project memory mixing.",
    command: "smctl init"
  });

  steps.push({
    id: "memory",
    title: "Trust memory before relying on it",
    status: trust?.summary?.fail > 0 || summary.memory.failed > 0 || repair?.summary?.fail > 0 || analysis?.score?.value < 70 ? "attention" : trust?.score?.value >= 85 ? "done" : "todo",
    detail: summary.memory.failed > 0
      ? `${summary.memory.failed} failed write(s) need repair before trusting recall.`
      : trust?.score
        ? `Trust Doctor: ${trust.score.value}/100 (${trust.score.label}).`
      : analysis?.score
        ? `Trust score ${analysis.score.value}/100 (${analysis.score.label}).`
        : "Run Trust Doctor from this panel to prove scope, health, and resilience.",
    command: "smctl trust --probe"
  });

  steps.push({
    id: "guard",
    title: "Review risky writes",
    status: summary.guard.pending > 0 ? "attention" : "done",
    detail: summary.guard.pending > 0 ? `${summary.guard.pending} write(s) waiting in Guard.` : "No pending guarded writes.",
    command: "smctl guard inbox"
  });

  return steps;
}

function readinessModel({ summary, setup, repair, project, analysis, trust }) {
  const journeys = journeySteps({ summary, setup, repair, project, analysis, trust });
  const weights = { local: 25, setup: 20, project: 15, memory: 30, guard: 10 };
  const score = journeys.reduce((total, step) => {
    const weight = weights[step.id] ?? 10;
    if (step.status === "done") return total + weight;
    if (step.status === "attention") return total + Math.floor(weight * 0.45);
    if (step.status === "todo") return total + Math.floor(weight * 0.2);
    return total;
  }, 0);
  const firstOpen = journeys.find((step) => step.status !== "done") ?? journeys[journeys.length - 1];
  const setupCreated = setup?.summary?.created ?? 0;
  const setupPlanned = setup?.summary?.["would-create"] ?? 0;
  const repairFail = repair?.summary?.fail ?? 0;
  const repairWarn = repair?.summary?.warn ?? 0;
  const trustScore = trust?.score?.value ?? analysis?.score?.value ?? null;
  return {
    score,
    label: score >= 90 ? "Demo-ready" : score >= 70 ? "Usable" : score >= 40 ? "Needs setup" : "Blocked",
    primary: firstOpen ? {
      title: firstOpen.status === "done" ? "Open the Supermemory dashboard" : firstOpen.title,
      detail: firstOpen.status === "done" ? "Harness is ready enough for a demo. Keep this dashboard open while the agent works." : firstOpen.detail,
      command: firstOpen.status === "done" ? "smctl ui" : firstOpen.command,
      status: firstOpen.status
    } : null,
    stats: {
      setupCreated,
      setupPlanned,
      repairFail,
      repairWarn,
      trustScore
    }
  };
}

async function proxySupermemory(context, request, response, url) {
  if (!context.fetch) {
    sendText(response, 500, "Fetch API unavailable; Node 22+ is required\n");
    return;
  }

  const upstreamUrl = `${context.upstream}${url.pathname}${url.search}`;
  const body = ["GET", "HEAD"].includes(request.method ?? "") ? undefined : await readBody(request);
  const upstreamResponse = await context.fetch(upstreamUrl, {
    method: request.method,
    headers: proxyHeaders(request.headers),
    body,
    redirect: "manual"
  });

  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const status = upstreamResponse.status;
  const headers = responseHeaders(upstreamResponse.headers);

  if (request.method === "GET" && contentType.includes("text/html")) {
    const html = await upstreamResponse.text();
    headers["content-type"] = contentType;
    send(response, status, injectHarnessBar(html), headers);
    return;
  }

  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
  send(response, status, buffer, headers);
}

export function injectHarnessBar(html) {
  const asset = harnessBarAsset();
  if (html.includes("data-smctl-harness-bar")) return html;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${asset}\n</body>`);
  }
  return `${html}\n${asset}`;
}

function harnessBarAsset() {
  return `<style data-smctl-harness-bar>
#smctl-harness-bar {
  position: sticky;
  top: 0;
  z-index: 2147483000;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: center;
  min-height: 38px;
  padding: 8px 18px;
  background: #0f1014;
  color: #f5f5f5;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.25;
}
#smctl-harness-bar .smctl-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
#smctl-harness-bar .smctl-chip {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  padding: 3px 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}
#smctl-harness-bar .smctl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
}
#smctl-harness-bar[data-state="warn"] .smctl-dot { background: #f59e0b; }
#smctl-harness-bar[data-state="fail"] .smctl-dot { background: #ef4444; }
#smctl-harness-bar .smctl-next {
  color: #cdf4ff;
  text-decoration: none;
  font-weight: 600;
}
#smctl-harness-bar .smctl-next:hover { text-decoration: underline; }
#smctl-harness-bar .smctl-open {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: #cdf4ff;
  color: #0f1014;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 5px 10px;
}
#smctl-harness-bar .smctl-open:hover { background: #ffffff; }
#smctl-harness-panel {
  position: fixed;
  top: 48px;
  right: 18px;
  z-index: 2147483001;
  width: min(760px, calc(100vw - 28px));
  max-height: calc(100vh - 72px);
  display: none;
  grid-template-rows: auto auto 1fr;
  overflow: hidden;
  color: #f5f5f5;
  background: #101217;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
#smctl-harness-panel[data-open="true"] { display: grid; }
#smctl-harness-panel .smctl-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
#smctl-harness-panel .smctl-panel-title {
  font-size: 14px;
  font-weight: 700;
}
#smctl-harness-panel .smctl-panel-subtitle {
  color: #a6adbb;
  font-size: 12px;
  margin-top: 2px;
}
#smctl-harness-panel .smctl-close {
  appearance: none;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: #f5f5f5;
  background: transparent;
  cursor: pointer;
}
#smctl-harness-panel .smctl-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
#smctl-harness-panel .smctl-tab {
  appearance: none;
  border: 0;
  border-radius: 6px;
  color: #b7bfcc;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 10px;
}
#smctl-harness-panel .smctl-tab[data-active="true"] {
  color: #0f1014;
  background: #cdf4ff;
}
#smctl-harness-panel .smctl-panel-body {
  overflow: auto;
  padding: 14px;
}
#smctl-harness-panel .smctl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
#smctl-harness-panel .smctl-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  border: 1px solid rgba(205, 244, 255, 0.32);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(205, 244, 255, 0.12), rgba(255, 255, 255, 0.04));
  padding: 14px;
  margin-bottom: 12px;
}
#smctl-harness-panel .smctl-hero-score {
  min-width: 118px;
  text-align: right;
}
#smctl-harness-panel .smctl-score {
  color: #ffffff;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}
#smctl-harness-panel .smctl-meter {
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
  margin-top: 10px;
}
#smctl-harness-panel .smctl-meter span {
  display: block;
  height: 100%;
  background: #cdf4ff;
}
#smctl-harness-panel .smctl-command {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  color: #dbeafe;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}
#smctl-harness-panel .smctl-command code {
  flex: 1;
  min-width: 0;
  white-space: normal;
}
#smctl-harness-panel .smctl-copy {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: transparent;
  color: #f5f5f5;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  padding: 5px 7px;
}
#smctl-harness-panel .smctl-card {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  padding: 12px;
}
#smctl-harness-panel .smctl-k {
  color: #a6adbb;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 5px;
  text-transform: uppercase;
}
#smctl-harness-panel .smctl-v {
  color: #f5f5f5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}
#smctl-harness-panel .smctl-list {
  display: grid;
  gap: 8px;
}
#smctl-harness-panel .smctl-row {
  display: grid;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px;
}
#smctl-harness-panel .smctl-row-title {
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}
#smctl-harness-panel .smctl-row-detail {
  color: #b7bfcc;
  font-size: 12px;
  line-height: 1.45;
}
#smctl-harness-panel .smctl-status {
  justify-self: start;
  border-radius: 999px;
  padding: 2px 7px;
  color: #0f1014;
  background: #d1d5db;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
#smctl-harness-panel .smctl-status[data-status="done"],
#smctl-harness-panel .smctl-status[data-status="ok"] { background: #86efac; }
#smctl-harness-panel .smctl-status[data-status="attention"],
#smctl-harness-panel .smctl-status[data-status="warn"] { background: #fcd34d; }
#smctl-harness-panel .smctl-status[data-status="blocked"],
#smctl-harness-panel .smctl-status[data-status="fail"] { background: #fca5a5; }
#smctl-harness-panel .smctl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
#smctl-harness-panel .smctl-action {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: #cdf4ff;
  color: #0f1014;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 8px 10px;
}
#smctl-harness-panel .smctl-action.secondary {
  background: transparent;
  color: #f5f5f5;
}
#smctl-harness-panel pre {
  overflow: auto;
  white-space: pre-wrap;
  color: #dbeafe;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
}
@media (max-width: 720px) {
  #smctl-harness-bar { grid-template-columns: 1fr; }
  #smctl-harness-panel .smctl-hero { grid-template-columns: 1fr; }
  #smctl-harness-panel .smctl-hero-score { text-align: left; }
  #smctl-harness-panel { top: 8px; right: 8px; left: 8px; width: auto; }
}
</style>
<div id="smctl-harness-bar" data-smctl-harness-bar data-state="warn">
  <div class="smctl-items"><span class="smctl-chip"><span class="smctl-dot"></span> Harness Bar loading</span></div>
  <a class="smctl-next" href="/__smctl/bar">loading</a>
  <button class="smctl-open" type="button">Open</button>
</div>
<section id="smctl-harness-panel" data-smctl-harness-bar aria-label="Supermemory Harness command center">
  <div class="smctl-panel-head">
    <div>
      <div class="smctl-panel-title">Supermemory Harness</div>
      <div class="smctl-panel-subtitle">Live memory operations inside this Supermemory tab</div>
    </div>
    <button class="smctl-close" type="button" aria-label="Close">x</button>
  </div>
  <div class="smctl-tabs"></div>
  <div class="smctl-panel-body">Loading...</div>
</section>
<script data-smctl-harness-bar>
(function () {
  const root = document.getElementById("smctl-harness-bar");
  const panel = document.getElementById("smctl-harness-panel");
  if (!root) return;
  const items = root.querySelector(".smctl-items");
  const next = root.querySelector(".smctl-next");
  const open = root.querySelector(".smctl-open");
  const close = panel && panel.querySelector(".smctl-close");
  const tabsEl = panel && panel.querySelector(".smctl-tabs");
  const body = panel && panel.querySelector(".smctl-panel-body");
  const tabs = ["Overview", "Trust", "Genome", "Setup", "Memory", "Repair", "Guard", "Events"];
  let panelData = null;
  let activeTab = "Overview";

  function stateFrom(data) {
    if (!data.local || data.local.status !== "online") return "fail";
    if ((data.memory && data.memory.failed > 0) || (data.guard && data.guard.risk && data.guard.risk.high > 0) || (data.watchdog && data.watchdog.status === "fail")) return "fail";
    const warnings = (data.local.summary && data.local.summary.warn) || 0;
    return warnings > 0 || (data.watchdog && data.watchdog.status !== "ok") ? "warn" : "ok";
  }
  function render(data) {
    root.dataset.state = stateFrom(data);
    items.innerHTML = "";
    for (const label of data.bar || []) {
      const chip = document.createElement("span");
      chip.className = "smctl-chip";
      if (label.startsWith("Local:")) {
        const dot = document.createElement("span");
        dot.className = "smctl-dot";
        chip.appendChild(dot);
      }
      chip.appendChild(document.createTextNode(label));
      items.appendChild(chip);
    }
    next.textContent = data.next || "smctl watch";
    next.href = "/__smctl/bar";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function status(value) {
    return '<span class="smctl-status" data-status="' + escapeHtml(value || "todo") + '">' + escapeHtml(value || "todo") + '</span>';
  }

  function card(label, value) {
    return '<div class="smctl-card"><div class="smctl-k">' + escapeHtml(label) + '</div><div class="smctl-v">' + escapeHtml(value) + '</div></div>';
  }

  function row(title, detail, state) {
    return '<div class="smctl-row">' + status(state) + '<div class="smctl-row-title">' + escapeHtml(title) + '</div><div class="smctl-row-detail">' + escapeHtml(detail) + '</div></div>';
  }

  function command(value) {
    if (!value) return "";
    return '<div class="smctl-command"><code>' + escapeHtml(value) + '</code><button class="smctl-copy" type="button" data-copy="' + escapeHtml(value) + '">Copy</button></div>';
  }

  function journeyRow(item) {
    return '<div class="smctl-row">' + status(item.status) + '<div class="smctl-row-title">' + escapeHtml(item.title) + '</div><div class="smctl-row-detail">' + escapeHtml(item.detail) + '</div>' + command(item.command) + '</div>';
  }

  function hero(readiness) {
    readiness = readiness || {};
    const primary = readiness.primary || {};
    const score = readiness.score == null ? 0 : readiness.score;
    return '<div class="smctl-hero"><div><div class="smctl-k">Readiness</div><div class="smctl-row-title">' + escapeHtml(primary.title || "Check Harness state") + '</div><div class="smctl-row-detail">' + escapeHtml(primary.detail || "Harness is loading the next best action.") + '</div>' + command(primary.command || "smctl enhance") + '</div><div class="smctl-hero-score"><div class="smctl-score">' + escapeHtml(score) + '</div><div class="smctl-row-detail">' + escapeHtml(readiness.label || "Unknown") + '</div><div class="smctl-meter"><span style="width:' + Math.max(0, Math.min(100, Number(score) || 0)) + '%"></span></div></div></div>';
  }

  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = tabs.map(function (tab) {
      return '<button class="smctl-tab" data-tab="' + tab + '" data-active="' + String(tab === activeTab) + '" type="button">' + tab + '</button>';
    }).join("");
    for (const button of tabsEl.querySelectorAll(".smctl-tab")) {
      button.addEventListener("click", function () {
        activeTab = button.dataset.tab;
        renderPanel();
      });
    }
  }

  function renderPanel() {
    if (!body || !panelData) return;
    renderTabs();
    const summary = panelData.summary || {};
    const memory = summary.memory || {};
    const guard = summary.guard || {};
    const setup = panelData.setup || {};
    const repair = panelData.repair || {};
    const project = panelData.project || {};
    const analysis = panelData.analysis || {};
    const trust = panelData.trust || {};
    const genome = panelData.genome || {};
    const readiness = panelData.readiness || {};
    if (activeTab === "Overview") {
      body.innerHTML = hero(readiness) + '<div class="smctl-grid">'
        + card("Local", (summary.local && summary.local.status) || "unknown")
        + card("Agents configured", ((summary.agents && summary.agents.configured) || 0) + "/" + ((summary.agents && summary.agents.total) || 0))
        + card("Writes sampled", memory.sampled || 0)
        + card("Queue", memory.queued || 0)
        + card("Guard pending", guard.pending || 0)
        + card("Next", summary.next || "smctl watch")
        + '</div><div class="smctl-list" style="margin-top:12px">'
        + (panelData.journeys || []).map(journeyRow).join("")
        + '</div>';
      wireCopy();
      return;
    }
    if (activeTab === "Trust") {
      const quality = analysis.quality || {};
      const docs = analysis.documents || {};
      const score = trust.score || analysis.score || {};
      const checks = trust.checks || [];
      const issues = checks.length ? checks : (analysis.issues || []);
      body.innerHTML = '<div class="smctl-grid">'
        + card("Trust score", score.value == null ? "unknown" : score.value + "/100")
        + card("Label", score.label || "unknown")
        + card("Mode", trust.mode || "read-only")
        + card("Failed writes", docs.failed ? docs.failed.length : 0)
        + card("Missing project", quality.missingProject ? quality.missingProject.length : 0)
        + card("Missing anchors", quality.missingAnchors ? quality.missingAnchors.length : 0)
        + card("Possible secrets", quality.risky ? quality.risky.length : 0)
        + '</div>' + command("smctl trust --probe") + '<div class="smctl-actions"><button class="smctl-action" data-action="trustProbe">Run live trust probe</button><button class="smctl-action secondary" data-action="reload">Refresh</button></div><div class="smctl-list" style="margin-top:12px">'
        + (issues.length ? issues.map(function (item) { return row(item.title, (item.detail || "") + (item.command ? " -> " + item.command : ""), item.status); }).join("") : row("No trust issues", "The sampled memory flow looks healthy.", "done"))
        + '</div>';
      wireActions();
      wireCopy();
      return;
    }
    if (activeTab === "Genome") {
      const mode = genome.mode || {};
      const score = genome.score || {};
      const policy = genome.policy || {};
      const categories = genome.categories || [];
      const gaps = genome.gaps || [];
      body.innerHTML = '<div class="smctl-grid">'
        + card("Genome score", score.value == null ? "unknown" : score.value + "/100")
        + card("Mode", mode.title || "unknown")
        + card("Confidence", mode.confidence == null ? "unknown" : Math.round(Number(mode.confidence) * 100) + "%")
        + card("Policy", genome.policyState || "unknown")
        + card("Profile facts", genome.supermemoryProfile && genome.supermemoryProfile.stats ? genome.supermemoryProfile.stats.total : "unknown")
        + card("Default container", policy.defaultContainerTag || "none")
        + '</div>' + command("smctl genome") + command("smctl genome apply")
        + '<div class="smctl-actions"><button class="smctl-action" data-action="genomeApply">Apply personalization policy</button><button class="smctl-action secondary" data-action="reload">Refresh</button></div>'
        + '<div class="smctl-list" style="margin-top:12px">'
        + row("Memory Genome", score.detail || "Classifies the stored memory mix and turns it into Guard policy.", score.value >= 65 ? "done" : "attention")
        + (categories.filter(function (item) { return item.count > 0; }).slice(0, 6).map(function (item) { return row(item.title, item.count + " memory item(s), " + item.percent + "% of sample", "ok"); }).join(""))
        + (gaps.length ? gaps.slice(0, 6).map(function (item) { return row(item.title, (item.detail || "") + (item.command ? " -> " + item.command : ""), item.status); }).join("") : row("No genome gaps", "Personalization looks ready.", "done"))
        + '</div><pre>' + escapeHtml(JSON.stringify({ remember: policy.remember || [], ignore: policy.ignore || [], askBeforeSaving: policy.askBeforeSaving || [], recallFirst: policy.recallFirst || [] }, null, 2)) + '</pre>';
      wireActions();
      wireCopy();
      return;
    }
    if (activeTab === "Setup") {
      const actions = setup.actions || [];
      body.innerHTML = '<div class="smctl-grid">'
        + card("Dry run", setup.error ? setup.error : "ready")
        + card("Created", setup.summary ? setup.summary.created : 0)
        + card("Would create", setup.summary ? setup.summary["would-create"] : 0)
        + card("Manual steps", setup.summary ? setup.summary.manual : 0)
        + '</div>' + command("smctl enhance") + '<div class="smctl-actions"><button class="smctl-action" data-action="setup">Apply safe setup files</button><button class="smctl-action secondary" data-action="reload">Refresh</button></div><div class="smctl-list" style="margin-top:12px">'
        + actions.map(function (item) { return row(item.title, (item.path ? item.path + " - " : "") + (item.detail || ""), item.status); }).join("")
        + '</div>';
      wireActions();
      wireCopy();
      return;
    }
    if (activeTab === "Memory") {
      body.innerHTML = '<div class="smctl-grid">'
        + card("Sampled", memory.sampled || 0)
        + card("Failed", memory.failed || 0)
        + card("Queued", memory.queued || 0)
        + card("Dreaming", memory.dreaming ? memory.dreaming.label : "unknown")
        + '</div>' + command("smctl verify") + '<div class="smctl-actions"><button class="smctl-action" data-action="verify">Run verify probe</button><button class="smctl-action secondary" data-action="reload">Refresh</button></div><pre>' + escapeHtml(JSON.stringify(memory.counts || {}, null, 2)) + '</pre>';
      wireActions();
      wireCopy();
      return;
    }
    if (activeTab === "Repair") {
      const checks = repair.checks || [];
      const actions = repair.actions || [];
      body.innerHTML = '<div class="smctl-grid">'
        + card("Repair status", repair.error ? repair.error : ((repair.summary && repair.summary.fail) || 0) + " fail")
        + card("Warnings", repair.summary ? repair.summary.warn : 0)
        + card("Store", repair.storage ? repair.storage.bytes + " bytes" : "unknown")
        + '</div>' + command("smctl repair wizard") + '<div class="smctl-list" style="margin-top:12px">'
        + checks.map(function (item) { return row(item.title, item.detail || "", item.status); }).join("")
        + actions.map(function (item) { return row(item.title, item.detail || "", "todo"); }).join("")
        + '</div>';
      wireCopy();
      return;
    }
    if (activeTab === "Guard") {
      const recent = guard.recent || [];
      body.innerHTML = '<div class="smctl-grid">'
        + card("Pending", guard.pending || 0)
        + card("High risk", guard.risk ? guard.risk.high : 0)
        + card("Medium risk", guard.risk ? guard.risk.medium : 0)
        + '</div>' + command("smctl guard inbox") + '<div class="smctl-list" style="margin-top:12px">'
        + (recent.length ? recent.map(function (item) { return row(item.id, item.preview || item.route || "", item.risk); }).join("") : row("No guarded writes", "Nothing is waiting for review.", "done"))
        + '</div>';
      wireCopy();
      return;
    }
    const events = summary.recentEvents || [];
    body.innerHTML = '<div class="smctl-list">'
      + (events.length ? events.map(function (item) { return row(item.title, item.container, item.status); }).join("") : row("No recent events", "Supermemory has no sampled recent documents yet.", "todo"))
      + '</div>';
  }

  function wireActions() {
    if (!body) return;
    for (const button of body.querySelectorAll("[data-action]")) {
      button.addEventListener("click", function () {
        const action = button.dataset.action;
        if (action === "reload") {
          loadPanel();
          return;
        }
        button.disabled = true;
        button.textContent = action === "setup" ? "Applying..." : "Running...";
        const url = action === "setup" ? "/__smctl/setup/apply" : action === "trustProbe" ? "/__smctl/trust/probe" : action === "genomeApply" ? "/__smctl/genome/apply" : "/__smctl/verify";
        fetch(url, { method: "POST", cache: "no-store" })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            body.innerHTML = '<pre>' + escapeHtml(result.text || JSON.stringify(result, null, 2)) + '</pre><div class="smctl-actions"><button class="smctl-action secondary" data-action="reload">Back to live panel</button></div>';
            wireActions();
            load();
          })
          .catch(function (error) {
            body.innerHTML = row("Action failed", error.message, "fail");
          });
      });
    }
  }

  function wireCopy() {
    if (!body) return;
    for (const button of body.querySelectorAll("[data-copy]")) {
      button.addEventListener("click", function () {
        const value = button.dataset.copy || "";
        const done = function () {
          button.textContent = "Copied";
          setTimeout(function () { button.textContent = "Copy"; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () {});
        } else {
          done();
        }
      });
    }
  }

  function loadPanel() {
    if (!panel || !body) return;
    body.textContent = "Loading...";
    fetch("/__smctl/panel", { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        panelData = data;
        renderPanel();
      })
      .catch(function (error) {
        body.innerHTML = row("Harness panel unavailable", error.message, "fail");
      });
  }

  function load() {
    fetch("/__smctl/bar", { cache: "no-store" })
      .then((response) => response.json())
      .then(render)
      .catch(() => {
        root.dataset.state = "fail";
        items.innerHTML = '<span class="smctl-chip"><span class="smctl-dot"></span> Harness Bar unavailable</span>';
      });
  }
  if (open && panel) {
    open.addEventListener("click", function () {
      const isOpen = panel.dataset.open === "true";
      panel.dataset.open = String(!isOpen);
      if (!isOpen) loadPanel();
    });
  }
  if (close && panel) {
    close.addEventListener("click", function () {
      panel.dataset.open = "false";
    });
  }
  load();
  setInterval(load, 5000);
}());
</script>`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function proxyHeaders(headers) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    if (["host", "content-length", "connection"].includes(key.toLowerCase())) continue;
    output[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return output;
}

function responseHeaders(headers) {
  const output = {};
  for (const [key, value] of headers.entries()) {
    if (["content-encoding", "content-length", "connection"].includes(key.toLowerCase())) continue;
    output[key] = value;
  }
  return output;
}

function sendJson(response, status, body) {
  send(response, status, `${JSON.stringify(body)}\n`, { "content-type": "application/json" });
}

function sendText(response, status, body) {
  send(response, status, body, { "content-type": "text/plain; charset=utf-8" });
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
