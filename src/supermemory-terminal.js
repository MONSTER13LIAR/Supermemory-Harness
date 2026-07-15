import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { runTrust } from "./trust.js";
import { runWatch } from "./watch.js";

export async function runSupermemoryTerminal(options = {}) {
  const action = options.action ?? "start";
  if (action !== "start") {
    throw new Error("Unknown supermemory action. Use: smctl supermemory start");
  }

  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    dryRun: Boolean(options.dryRun),
    intervalMs: options.intervalMs ?? 30000,
    command: options.command ?? null,
    spawn: options.spawn ?? spawn
  };

  const command = context.command ?? await findSupermemoryServer(context);
  if (!command) {
    return result("supermemory start", 1, [
      "[harness] Supermemory server binary not found.",
      "[harness] Expected supermemory-server on PATH or ~/.supermemory/bin/supermemory-server."
    ]);
  }

  if (context.dryRun) {
    return result("supermemory start", 0, [
      "[harness] Would start Supermemory Local with Harness terminal overlay.",
      `[harness] Command: ${command}`,
      `[harness] Harness health interval: ${context.intervalMs}ms`
    ]);
  }

  process.stdout.write(`[harness] launching Supermemory Local with Harness terminal overlay: ${command}\n`);
  const child = context.spawn(command, [], {
    cwd: context.cwd,
    env: context.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stdout.write(prefixLines("supermemory", chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines("supermemory", chunk)));

  const printWatchdog = (label) => {
    printHarnessSnapshot(context, label).catch((error) => {
      process.stderr.write(`[harness] ${label} failed: ${error.message}\n`);
    });
  };
  const startupTimer = setTimeout(() => printWatchdog("startup"), 1500);
  const timer = setInterval(() => printWatchdog("watchdog"), context.intervalMs);

  const cleanup = () => {
    clearTimeout(startupTimer);
    clearInterval(timer);
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      clearTimeout(startupTimer);
      clearInterval(timer);
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      resolve(result("supermemory start", exitCode, [
        `[harness] Supermemory process exited${signal ? ` by ${signal}` : ""} with code ${exitCode}.`
      ]));
    });
  });
}

async function printHarnessSnapshot(context, label) {
  const now = new Date().toISOString();
  const trust = await runTrust({
    baseUrl: context.baseUrl,
    home: context.home,
    cwd: context.cwd,
    fetch: context.fetch,
    limit: 25
  });

  const watch = await runWatch({
    baseUrl: context.baseUrl,
    home: context.home,
    cwd: context.cwd,
    env: context.env,
    fetch: context.fetch,
    limit: 8
  });
  for (const line of formatHarnessSnapshotLines({ label, now, trust, watch })) {
    process.stdout.write(`${line}\n`);
  }
}

export function formatHarnessSnapshotLines({ label, now, trust, watch }) {
  const lines = [
    `[harness] ${label} ${now} Trust ${trust.score.value}/100 (${trust.score.label}); ${trust.summary.fail} fail, ${trust.summary.warn} warn`
  ];

  const failures = trust.checks.filter((check) => check.status === "fail").slice(0, 2);
  const warnings = trust.checks.filter((check) => check.status === "warn").slice(0, 2);
  if (failures.length > 0) {
    for (const failure of failures) {
      lines.push(`[harness] blocker: ${failure.title} - ${failure.detail}`);
    }
  } else if (warnings.length > 0) {
    for (const warning of warnings) {
      lines.push(`[harness] warning: ${warning.title} - ${warning.detail}`);
    }
  } else {
    lines.push("[harness] blockers: none detected in current trust snapshot");
  }

  lines.push(`[harness] agents: ${watch.agents.configured}/${watch.agents.total} configured; active: ${watch.agents.active.length ? watch.agents.active.join(", ") : "none"}`);
  lines.push(`[harness] memory: writes ${watch.memory.sampled}; queue ${watch.memory.queued}; failed ${watch.memory.failed}; dreaming ${watch.memory.dreaming.label}`);
  lines.push(`[harness] guard: ${watch.guard.pending} pending; risk low:${watch.guard.risk.low} medium:${watch.guard.risk.medium} high:${watch.guard.risk.high}`);

  const next = trust.next.length > 0 ? trust.next.join(" | ") : watch.next;
  lines.push(`[harness] next: ${next}`);
  return lines;
}

async function findSupermemoryServer(context) {
  const pathEntry = await which("supermemory-server", context.env);
  if (pathEntry) return pathEntry;
  const local = join(context.home, ".supermemory", "bin", "supermemory-server");
  return await exists(local) ? local : null;
}

async function which(command, env) {
  const paths = String(env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of paths) {
    const candidate = join(dir, command);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function prefixLines(prefix, chunk) {
  return String(chunk)
    .split(/(\r?\n)/)
    .map((part) => part === "\n" || part === "\r\n" || part === "" ? part : `[${prefix}] ${part}`)
    .join("");
}

function result(command, exitCode, lines) {
  return {
    command,
    generatedAt: new Date().toISOString(),
    exitCode,
    text: lines.join("\n")
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
