import { homedir } from "node:os";
import { runDoctor } from "./doctor.js";
import { memoryDoctor } from "./memory.js";
import { runSetup } from "./setup.js";
import { runSmart } from "./smart.js";

export async function runInstall(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    guardUrl: normalizeBaseUrl(options.guardUrl ?? "http://localhost:6777"),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    dryRun: Boolean(options.dryRun),
    interactive: Boolean(options.interactive)
  };

  const doctor = await runDoctor({
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: options.fetch
  });

  const setup = await runSetup({
    baseUrl: context.guardUrl,
    home: context.home,
    dryRun: context.dryRun,
    target: "all"
  });

  const memory = doctor.exitCode === 0
    ? await memoryDoctor({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: options.fetch,
      limit: 25
    })
    : null;

  const smart = await configureSmart(context, options);

  const checks = [
    doctor.exitCode === 0
      ? ok("Supermemory Local is reachable", `${doctor.summary.ok} doctor checks passed`)
      : warn("Supermemory Local needs attention", `${doctor.summary.fail} failing doctor check(s)`),
    setup.exitCode === 0
      ? ok("Harness config files are ready", `${setupSummary(setup)}; clients point at Guard`)
      : fail("Harness setup failed", setupSummary(setup)),
    smartCheck(smart),
    memory && memory.exitCode === 0
      ? ok("Memory health sampled", `${memory.summary.ok} memory checks passed`)
      : warn("Memory health needs review", memory ? `${memory.summary.fail} fail, ${memory.summary.warn} warn` : "Skipped because doctor failed"),
    info("Guard proxy", `Run smctl guard start, then point clients at ${context.guardUrl} for review-before-commit`)
  ];

  const summary = summarize(checks);
  const result = {
    command: "install",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    guardUrl: context.guardUrl,
    dryRun: context.dryRun,
    doctor: {
      exitCode: doctor.exitCode,
      summary: doctor.summary
    },
    setup: {
      exitCode: setup.exitCode,
      summary: setup.summary,
      actions: setup.actions
    },
    memory: memory ? {
      exitCode: memory.exitCode,
      summary: memory.summary,
      sampled: memory.documents.sampled
    } : null,
    smart,
    checks,
    nextSteps: [
      "smctl guard start",
      "smctl status",
      "smctl memory doctor"
    ],
    exitCode: summary.fail > 0 ? 1 : 0,
    summary
  };
  result.text = formatInstall(result);
  return result;
}

function formatInstall(result) {
  const lines = [];
  lines.push("=================================");
  lines.push("   Supermemory Harness");
  lines.push("=================================");
  lines.push("");
  lines.push("Supermemory Harness install");
  lines.push(`Supermemory: ${result.baseUrl}`);
  lines.push(`Guard proxy: ${result.guardUrl}`);
  lines.push(`Mode: ${result.dryRun ? "dry-run" : "write"}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail, ${result.summary.info} info`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) {
      lines.push(`   ${check.detail}`);
    }
  }

  lines.push("");
  lines.push("Next:");
  for (const step of result.nextSteps) {
    lines.push(`   ${step}`);
  }

  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: Supermemory Harness is installed."
    : "Result: install completed with issues to review.");
  return lines.join("\n");
}

async function configureSmart(context, options) {
  if (context.dryRun) {
    return { status: "skipped", detail: "Dry-run mode" };
  }

  const doctor = await runSmart({
    action: "doctor",
    home: context.home,
    env: context.env
  });
  if (doctor.exitCode === 0) {
    const ping = await runSmart({
      action: "ping",
      home: context.home,
      env: context.env,
      fetch: options.fetch
    });
    return {
      status: ping.exitCode === 0 ? "ready" : "needs-attention",
      detail: ping.exitCode === 0 ? "Smart Assist is enabled and provider ping passed" : ping.status ?? "Smart Assist is enabled but ping needs attention",
      doctor,
      ping
    };
  }

  if (!context.interactive) {
    return {
      status: "not-enabled",
      detail: "Run smctl install in a terminal or run smctl smart enable --prompt"
    };
  }

  const shouldEnable = await askConfirm("Enable Smart Assist now? This stores your pasted provider key in a local 0600 Harness secret file. [Y/n] ", true);
  if (!shouldEnable) {
    return { status: "skipped", detail: "Smart Assist skipped by user" };
  }

  const enable = await runSmart({
    action: "enable",
    home: context.home,
    env: context.env,
    prompt: true,
    yes: true,
    provider: options.provider,
    model: options.model
  });
  if (enable.exitCode !== 0) {
    return { status: "failed", detail: enable.detail, enable };
  }

  const ping = await runSmart({
    action: "ping",
    home: context.home,
    env: context.env,
    fetch: options.fetch
  });
  return {
    status: ping.exitCode === 0 ? "ready" : "needs-attention",
    detail: ping.exitCode === 0 ? "Smart Assist is enabled and provider ping passed" : ping.detail,
    enable,
    ping
  };
}

function smartCheck(smart) {
  if (!smart) return warn("Smart Assist", "Skipped");
  if (smart.status === "ready") return ok("Smart Assist", smart.detail);
  if (smart.status === "failed") return fail("Smart Assist", smart.detail);
  if (smart.status === "not-enabled") return warn("Smart Assist", smart.detail);
  return info("Smart Assist", smart.detail);
}

async function askConfirm(question, defaultValue) {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || !output.isTTY) return defaultValue;
  output.write(question);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve) => {
    const onData = (chunk) => {
      input.off("data", onData);
      input.pause();
      const answer = String(chunk).trim().toLowerCase();
      if (!answer) {
        resolve(defaultValue);
        return;
      }
      resolve(answer === "y" || answer === "yes");
    };
    input.on("data", onData);
  });
}

function setupSummary(setup) {
  const summary = setup.summary;
  return `${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.manual} manual`;
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0, info: 0 });
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

function info(title, detail) {
  return { status: "info", title, detail };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  if (status === "fail") return "[fail]";
  return "[info]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
