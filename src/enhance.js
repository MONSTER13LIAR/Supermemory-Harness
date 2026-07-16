import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runAgentBridge } from "./agent-bridge.js";
import { runDoctor } from "./doctor.js";
import { runInstall } from "./install.js";
import { runNativeEnhance } from "./native-enhance.js";
import { projectDoctor, projectInit } from "./project.js";
import { runSetup } from "./setup.js";
import { runWatch } from "./watch.js";
import { attachSmartSections } from "./smart-sections.js";

export async function runEnhance(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    guardUrl: normalizeBaseUrl(options.guardUrl ?? "http://localhost:6777"),
    uiUrl: normalizeBaseUrl(options.uiUrl ?? "http://localhost:6778"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    dryRun: Boolean(options.dryRun),
    sourcePath: options.sourcePath ?? null,
    startUi: options.startUi ?? startUiProcess
  };

  const doctor = await runDoctor({
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch
  });
  const setup = await runSetup({
    baseUrl: context.baseUrl,
    home: context.home,
    dryRun: context.dryRun,
    target: "all"
  });
  const install = await runInstall({
    baseUrl: context.baseUrl,
    guardUrl: context.guardUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch,
    dryRun: context.dryRun,
    interactive: false
  });
  const agentBridge = await runAgentBridge({
    action: "connect",
    target: "all",
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch,
    dryRun: context.dryRun
  });
  const project = await ensureProjectScope({
    home: context.home,
    cwd: context.cwd,
    dryRun: context.dryRun
  });
  const native = await runNativeEnhance({
    cwd: context.cwd,
    home: context.home,
    sourcePath: context.sourcePath,
    dryRun: context.dryRun
  });

  const ui = await enhanceUi(context, doctor);
  const watch = doctor.exitCode === 0
    ? await runWatch({
      baseUrl: context.baseUrl,
      cwd: context.cwd,
      env: context.env,
      home: context.home,
      fetch: context.fetch,
      limit: 12
    })
    : null;

  const actions = [
    actionFromResult("Supermemory Local", doctor.exitCode === 0 ? "ready" : "needs-attention", doctor.exitCode === 0 ? "Local server is reachable." : "Start supermemory-server first."),
    actionFromResult("Local agent config", setup.exitCode === 0 ? "ready" : "needs-attention", setupSummary(setup)),
    actionFromResult("Harness plugin layer", install.exitCode === 0 ? "ready" : "needs-attention", installSummary(install)),
    actionFromResult("Codex and Claude agent bridge", agentBridgeStatus(agentBridge), agentBridgeSummary(agentBridge)),
    actionFromResult("Project memory scope", projectActionStatus(project), projectSummary(project)),
    actionFromResult("Terminal-native Supermemory runtime", "ready", "Use smctl supermemory start so Harness health appears in the Supermemory log stream."),
    actionFromResult("Native Supermemory enhancement", nativeActionStatus(native), nativeSummary(native)),
    ui,
    actionFromResult("Memory loop visibility", watch ? "ready" : "needs-attention", watch ? watch.bar.join(" | ") : "Skipped until Supermemory is reachable.")
  ];
  const activation = await writeActivationReceipt(context, {
    doctor,
    setup,
    install,
    agentBridge,
    project,
    native,
    ui,
    watch
  });
  actions.push(actionFromResult("Harness activation receipt", activation.status, activation.detail));

  const summary = summarize(actions);
  const result = {
    command: "enhance",
    generatedAt: new Date().toISOString(),
    product: "Supermemory Harness",
    feature: "Harness Enhance",
    baseUrl: context.baseUrl,
    guardUrl: context.guardUrl,
    uiUrl: context.uiUrl,
    dryRun: context.dryRun,
    actions,
    doctor: { exitCode: doctor.exitCode, summary: doctor.summary },
    setup: { exitCode: setup.exitCode, summary: setup.summary },
    install: { exitCode: install.exitCode, summary: install.summary },
    agentBridge: {
      exitCode: agentBridge.exitCode,
      target: agentBridge.target,
      summary: agentBridge.summary,
      actions: agentBridge.actions
    },
    project: project.profile ?? null,
    native: {
      status: native.status,
      sourceRoot: native.sourceRoot,
      summary: native.summary,
      actions: native.actions
    },
    watch: watch ? {
      exitCode: watch.exitCode,
      bar: watch.bar,
      next: watch.next
    } : null,
    activation,
    next: nextSteps({ doctor, project, ui, watch, context }),
    summary,
    exitCode: summary["needs-attention"] > 0 ? 1 : 0
  };
  result.text = formatEnhance(result);
  return attachSmartSections(result, options);
}

async function enhanceUi(context, doctor) {
  if (doctor.exitCode !== 0) {
    return actionFromResult("Embedded Supermemory dashboard", "needs-attention", "Skipped until Supermemory Local is reachable.");
  }
  if (context.dryRun) {
    return actionFromResult("Embedded Supermemory dashboard", "planned", `Would start smctl ui at ${context.uiUrl}.`);
  }
  const existing = await probeUrl(context.fetch, context.uiUrl);
  if (existing.ok) {
    return actionFromResult("Embedded Supermemory dashboard", "ready", `Already running at ${context.uiUrl}.`);
  }
  const started = await context.startUi({
    cwd: context.cwd,
    uiUrl: context.uiUrl
  });
  return actionFromResult("Embedded Supermemory dashboard", started.status, started.detail);
}

async function ensureProjectScope({ home, cwd, dryRun }) {
  const doctor = await projectDoctor({ home, cwd });
  if (doctor.exitCode === 0) return doctor;
  if (dryRun) {
    return {
      ...doctor,
      planned: true,
      exitCode: 0
    };
  }
  const init = await projectInit({ home, cwd });
  return {
    ...await projectDoctor({ home, cwd }),
    initialized: true,
    init
  };
}

async function writeActivationReceipt(context, parts) {
  const receipt = {
    product: "Supermemory Harness",
    feature: "Harness Enhance",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    guardUrl: context.guardUrl,
    uiUrl: context.uiUrl,
    dryRun: context.dryRun,
    automatic: {
      setup: parts.setup.exitCode === 0,
      skills: parts.install.exitCode === 0,
      agentBridge: parts.agentBridge.exitCode === 0,
      dashboardInjection: ["ready", "planned"].includes(parts.ui.status),
      terminalRuntime: true,
      nativeEnhancement: parts.native.status === "ready",
      projectScope: parts.project.exitCode === 0,
      memoryVisibility: Boolean(parts.watch)
    },
    next: {
      normalServerCommand: "smctl supermemory start",
      dashboardUrl: context.uiUrl,
      preActionGate: "smctl gate",
      repair: parts.watch?.next ?? "smctl repair wizard"
    }
  };

  if (context.dryRun) {
    return {
      status: "planned",
      path: activationReceiptPath(context.home),
      receipt,
      detail: `Would write activation receipt to ${redactHome(activationReceiptPath(context.home), context.home)}.`
    };
  }

  const path = activationReceiptPath(context.home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return {
    status: "ready",
    path,
    receipt,
    detail: `Wrote activation receipt to ${redactHome(path, context.home)}.`
  };
}

async function probeUrl(fetchFn, url) {
  if (!fetchFn) return { ok: false };
  try {
    const response = await fetchFn(url, {
      method: "GET",
      signal: AbortSignal.timeout(750)
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function startUiProcess({ cwd }) {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return {
      status: "planned",
      detail: "Run smctl ui to start the embedded Supermemory dashboard."
    };
  }

  const child = spawn(process.execPath, [entrypoint, "ui"], {
    cwd,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return {
    status: "ready",
    detail: "Started smctl ui in the background."
  };
}

function formatEnhance(result) {
  const lines = [];
  lines.push("Supermemory Harness Enhance");
  lines.push(`Supermemory: ${result.baseUrl}`);
  lines.push(`Dashboard: ${result.uiUrl}`);
  lines.push(`Mode: ${result.dryRun ? "dry-run" : "automatic"}`);
  lines.push(`Summary: ${result.summary.ready} ready, ${result.summary.planned} planned, ${result.summary["needs-attention"]} needs-attention`);
  lines.push("");
  for (const action of result.actions) {
    lines.push(`${symbol(action.status)} ${action.title}`);
    lines.push(`   ${action.detail}`);
  }
  lines.push("");
  lines.push("Next:");
  for (const step of result.next) {
    lines.push(`   ${step}`);
  }
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: Harness Enhance made Supermemory agent-memory ready."
    : "Result: Harness Enhance completed with issues to review.");
  return lines.join("\n");
}

function nextSteps({ doctor, project, ui, watch, context }) {
  const steps = [];
  if (doctor.exitCode !== 0) steps.push("Start Supermemory Local through Harness: smctl supermemory start");
  if (project.exitCode !== 0) steps.push("Run smctl init from your code project");
  if (ui.status !== "ready") steps.push("Run smctl ui");
  steps.push("Use smctl supermemory start for the normal Supermemory terminal");
  if (watch?.next) steps.push(watch.next);
  steps.push(`Open ${context.uiUrl}`);
  return [...new Set(steps)].slice(0, 5);
}

function actionFromResult(title, status, detail) {
  return { title, status, detail };
}

function setupSummary(setup) {
  const summary = setup.summary;
  return `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary["would-create"]} would-create, ${summary["would-update"]} would-update, ${summary.manual} manual`;
}

function projectActionStatus(project) {
  if (project.planned) return "planned";
  return project.exitCode === 0 ? "ready" : "needs-attention";
}

function projectSummary(project) {
  if (project.profile) {
    return `${project.initialized ? "Initialized " : ""}${project.profile.name} -> ${project.profile.containerTag}`;
  }
  if (project.planned) return "Would initialize project memory scope from the current folder.";
  return "Could not initialize project memory scope.";
}

function installSummary(install) {
  return `${install.summary.ok} ok, ${install.summary.warn} warn, ${install.summary.fail} fail`;
}

function agentBridgeStatus(agentBridge) {
  if (agentBridge.exitCode !== 0) return "needs-attention";
  if (agentBridge.dryRun) return "planned";
  return "ready";
}

function agentBridgeSummary(agentBridge) {
  const summary = agentBridge.summary;
  const installed = summary.connected ?? 0;
  const planned = summary.planned ?? 0;
  const failed = summary.failed ?? 0;
  if (agentBridge.dryRun) {
    return `${planned} bridge file(s) would be installed for ${agentBridge.target}.`;
  }
  return `${installed} bridge file(s) installed for ${agentBridge.target}; ${failed} failed.`;
}

function nativeActionStatus(native) {
  if (native.exitCode !== 0 || native.status === "needs-attention") return "needs-attention";
  if (native.status === "skipped") return "planned";
  return "ready";
}

function nativeSummary(native) {
  if (!native.sourceRoot) {
    return "No Supermemory Desktop source checkout found; using embedded dashboard integration.";
  }
  const parts = [];
  if (native.summary.updated) parts.push(`${native.summary.updated} updated`);
  if (native.summary["would-update"]) parts.push(`${native.summary["would-update"]} would-update`);
  if (native.summary.unchanged) parts.push(`${native.summary.unchanged} unchanged`);
  if (native.summary.failed) parts.push(`${native.summary.failed} failed`);
  return `${native.sourceRoot}: ${parts.join(", ") || "checked"}`;
}

function summarize(actions) {
  return actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, { ready: 0, planned: 0, "needs-attention": 0 });
}

function symbol(status) {
  if (status === "ready") return "[ok]";
  if (status === "planned") return "[plan]";
  return "[warn]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function activationReceiptPath(home) {
  return join(home, ".config", "smctl", "activation.json");
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
