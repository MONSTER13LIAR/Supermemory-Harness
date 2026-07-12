import { runDoctor } from "./doctor.js";
import { runGuard } from "./guard.js";
import { appendExplanation, explainHarnessResult } from "./local-brain.js";
import { projectDoctor } from "./project.js";
import { repairWatchdog } from "./repair.js";
import { skillsInstall } from "./skills.js";
import { runSmart } from "./smart.js";

export async function runStart(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    upstream: normalizeBaseUrl(options.upstream ?? "http://localhost:6767"),
    port: options.port ?? 6777,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    home: options.home,
    fetch: options.fetch ?? globalThis.fetch,
    dryRun: Boolean(options.dryRun)
  };

  const doctor = await runDoctor({
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch
  });
  const project = await projectDoctor({ home: context.home, cwd: context.cwd });
  const skills = await skillsInstall({ home: context.home, dryRun: context.dryRun });
  const smart = await runSmart({ action: "doctor", home: context.home, env: context.env });
  const ollama = await checkOllama(context);
  const watchdog = doctor.exitCode === 0
    ? await repairWatchdog({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: 25
    })
    : null;

  const checks = [
    doctor.exitCode === 0
      ? ok("Supermemory Local", `${doctor.summary.ok} checks passed`)
      : fail("Supermemory Local", `${doctor.summary.fail} failing check(s); start Supermemory Local first`),
    project.exitCode === 0
      ? ok("Project profile", project.profile.name)
      : warn("Project profile", "Run smctl init from this project folder"),
    skills.exitCode === 0
      ? ok("Agent memory skills", skillsSummary(skills))
      : fail("Agent memory skills", "Could not install skills"),
    smart.exitCode === 0
      ? ok("Smart Assist", "enabled")
      : warn("Smart Assist", "optional; deterministic mode is available"),
    watchdog && watchdog.status === "ok"
      ? ok("Repair Watchdog", watchdog.detail)
      : warn("Repair Watchdog", watchdog ? watchdog.detail : "skipped until Supermemory is reachable"),
    ollama.available
      ? ok("Local brain", `${ollama.detail}`)
      : warn("Local brain", "Ollama not detected; deterministic mode is available")
  ];

  const summary = summarize(checks);
  const result = {
    command: "start",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    guardUrl: `http://localhost:${context.port}`,
    dryRun: context.dryRun,
    doctor: { exitCode: doctor.exitCode, summary: doctor.summary },
    project: project.profile ?? null,
    skills: { exitCode: skills.exitCode, summary: skills.summary },
    smart: { exitCode: smart.exitCode, enabled: smart.enabled },
    watchdog: watchdog ? { status: watchdog.status, detail: watchdog.detail } : null,
    ollama,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatStart(result);
  if (options.explain && (context.dryRun || result.exitCode !== 0)) {
    result.explanation = await explainHarnessResult(result, {
      fetch: context.fetch,
      ollamaModel: options.ollamaModel
    });
    result.text = appendExplanation(result.text, result.explanation);
  }

  if (result.exitCode !== 0 || context.dryRun) {
    return result;
  }

  console.log(result.text);
  return runGuard({
    action: "start",
    home: context.home,
    port: context.port,
    upstream: context.upstream,
    fetch: context.fetch
  });
}

async function checkOllama(context) {
  if (!context.fetch) return { available: false, detail: "fetch unavailable" };
  try {
    const response = await context.fetch("http://localhost:11434/api/tags");
    if (!response.ok) return { available: false, detail: `HTTP ${response.status}` };
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((model) => model.name).filter(Boolean) : [];
    return {
      available: true,
      detail: models.length > 0 ? `Ollama running (${models.slice(0, 3).join(", ")})` : "Ollama running, no models listed",
      models
    };
  } catch (error) {
    return { available: false, detail: error.cause?.code ?? error.message };
  }
}

function formatStart(result) {
  const lines = [];
  lines.push("=================================");
  lines.push("   Supermemory Harness running");
  lines.push("=================================");
  lines.push("");
  lines.push(`Supermemory: ${result.baseUrl}`);
  lines.push(`Guard: ${result.guardUrl}`);
  lines.push(`Mode: ${result.dryRun ? "dry-run" : "run"}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  lines.push("");
  if (result.project) {
    lines.push(`Active project: ${result.project.name}`);
    lines.push(`Container: ${result.project.containerTag}`);
  } else {
    lines.push("Active project: none");
  }
  lines.push("");
  if (result.exitCode !== 0) {
    lines.push("Result: start blocked. Fix failing checks and run smctl start again.");
  } else if (result.dryRun) {
    lines.push("Result: ready to start Guard. Run smctl start to begin.");
  } else {
    lines.push("Future Supermemory writes through Guard will receive project and skill metadata.");
  }
  return lines.join("\n");
}

function skillsSummary(skills) {
  const summary = skills.summary;
  return `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary["would-create"]} would-create, ${summary["would-update"]} would-update`;
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
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
