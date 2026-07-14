import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { runDoctor } from "./doctor.js";
import { runInstall } from "./install.js";
import { runNativeEnhance } from "./native-enhance.js";
import { projectDoctor } from "./project.js";
import { runSetup } from "./setup.js";
import { runWatch } from "./watch.js";

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
  const project = await projectDoctor({
    home: context.home,
    cwd: context.cwd
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
    actionFromResult("Project memory scope", project.exitCode === 0 ? "ready" : "needs-attention", project.profile ? `${project.profile.name} -> ${project.profile.containerTag}` : "Run smctl init from your project folder."),
    actionFromResult("Native Supermemory enhancement", nativeActionStatus(native), nativeSummary(native)),
    ui,
    actionFromResult("Memory loop visibility", watch ? "ready" : "needs-attention", watch ? watch.bar.join(" | ") : "Skipped until Supermemory is reachable.")
  ];

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
    next: nextSteps({ doctor, project, ui, watch, context }),
    summary,
    exitCode: summary["needs-attention"] > 0 ? 1 : 0
  };
  result.text = formatEnhance(result);
  return result;
}

async function enhanceUi(context, doctor) {
  if (doctor.exitCode !== 0) {
    return actionFromResult("Embedded Supermemory dashboard", "needs-attention", "Skipped until Supermemory Local is reachable.");
  }
  if (context.dryRun) {
    return actionFromResult("Embedded Supermemory dashboard", "planned", `Would start smctl ui at ${context.uiUrl}.`);
  }
  const started = await context.startUi({
    cwd: context.cwd,
    uiUrl: context.uiUrl
  });
  return actionFromResult("Embedded Supermemory dashboard", started.status, started.detail);
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
  if (doctor.exitCode !== 0) steps.push("Start Supermemory Local: supermemory-server");
  if (project.exitCode !== 0) steps.push("Run smctl init from your code project");
  if (ui.status !== "ready") steps.push("Run smctl ui");
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

function installSummary(install) {
  return `${install.summary.ok} ok, ${install.summary.warn} warn, ${install.summary.fail} fail`;
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
