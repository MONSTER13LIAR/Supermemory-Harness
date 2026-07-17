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
    startupDelayMs: options.startupDelayMs ?? 7000,
    detectExisting: options.detectExisting ?? !options.spawn,
    command: options.command ?? null,
    spawn: options.spawn ?? spawn
  };
  const launchCwd = options.launchCwd ?? context.home;

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
      `[harness] Launch cwd: ${launchCwd}`,
      `[harness] Harness health interval: ${context.intervalMs}ms`
    ]);
  }

  if (context.detectExisting) {
    const existing = await detectExistingServer(context);
    if (existing.status === "supermemory") {
      return result("supermemory start", 0, [
        `[harness] Supermemory Local is already running at ${context.baseUrl}.`,
        "[harness] No duplicate server started; port 6767 is already in use by the active Local runtime.",
        "[harness] For a fresh startup-log screenshot, stop the existing Supermemory terminal with Ctrl+C, then run smctl supermemory start again.",
        "[harness] Next: smctl trust --probe | smctl verify | smctl ui"
      ]);
    }
    if (existing.status === "occupied") {
      return result("supermemory start", 1, [
        `[harness] ${context.baseUrl} is already responding, but it does not look like Supermemory Local.`,
        `[harness] ${existing.detail}`,
        "[harness] Stop the process using port 6767 or choose a different Supermemory base URL."
      ]);
    }
  }

  process.stdout.write(`[harness] launching Supermemory Local with Harness terminal overlay: ${command}\n`);
  process.stdout.write(`[harness] launch cwd: ${launchCwd}\n`);
  const stdoutFilter = createSupermemoryLogFilter();
  const stderrFilter = createSupermemoryLogFilter();
  const child = context.spawn(command, [], {
    cwd: launchCwd,
    env: context.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stdout.write(prefixLines("supermemory", stdoutFilter(chunk))));
  child.stderr.on("data", (chunk) => process.stderr.write(prefixLines("supermemory", stderrFilter(chunk))));

  const printWatchdog = (label) => {
    printHarnessSnapshot(context, label).catch((error) => {
      process.stderr.write(`[harness] ${label} failed: ${error.message}\n`);
    });
  };
  const startupTimer = setTimeout(() => printWatchdog("startup"), context.startupDelayMs);
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

async function detectExistingServer(context) {
  if (!context.fetch) return { status: "offline" };
  const openapi = await fetchStatus(context.fetch, `${context.baseUrl}/v4/openapi`);
  if (openapi.ok) return { status: "supermemory" };

  const root = await fetchStatus(context.fetch, context.baseUrl);
  if (!root.reachable) return { status: "offline" };

  return {
    status: "occupied",
    detail: `/v4/openapi returned ${openapi.detail}; root returned ${root.detail}.`
  };
}

async function fetchStatus(fetchImpl, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return {
      reachable: true,
      ok: response.ok,
      detail: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      detail: error.cause?.code ?? error.name ?? error.message
    };
  } finally {
    clearTimeout(timeout);
  }
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
  lines.push(`[harness] mcp: ${watch.local.mcp.label} - ${watch.local.mcp.detail}`);
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

export function prefixLines(prefix, chunk) {
  return redactSecrets(String(chunk))
    .split(/(\r?\n)/)
    .map((part) => part === "\n" || part === "\r\n" || part === "" ? part : `[${prefix}] ${part}`)
    .join("");
}

export function createSupermemoryLogFilter() {
  const seen = new Set();
  return (chunk) => filterSupermemoryLogChunk(chunk, seen);
}

export function filterSupermemoryLogChunk(chunk, seen = new Set()) {
  const text = redactSecrets(String(chunk));
  if (isAuthNoise(text)) {
    return once(seen, "better-auth-allowed-attempts", "[harness] collapsed repeated Supermemory auth warning: better-auth allowedAttempts is ignored.\n");
  }
  if (isSchemaMismatch(text)) {
    const objects = [];
    if (/dreaming_status/.test(text)) objects.push("dreaming_status");
    if (/profile_buckets/.test(text)) objects.push("profile_buckets");
    if (/dreaming_job/.test(text)) objects.push("dreaming_job");
    const objectText = objects.length > 0 ? objects.join(", ") : "expected schema objects";
    return once(seen, `schema-mismatch:${objectText}`, [
      `[harness] Supermemory schema mismatch detected: missing ${objectText}.`,
      "[harness] Fix: stop this process, run `supermemory-server upgrade`, then restart with `smctl supermemory start`."
    ].join("\n") + "\n");
  }
  if (/Failed query:|queryWithCache|\/\$bunfs\/root\/supermemory-server|processTicksAndRejections|parse_relation\.c|errorMissingColumn/.test(text)) {
    return once(seen, "stacktrace-collapsed", "[harness] collapsed repeated Supermemory stack trace; run `supermemory-server upgrade` if schema errors continue.\n");
  }
  return text;
}

function once(seen, key, message) {
  if (seen.has(key)) return "";
  seen.add(key);
  return message;
}

function isAuthNoise(text) {
  return text.includes("[better-auth/magic-link]") && text.includes("allowedAttempts");
}

function isSchemaMismatch(text) {
  return /column "(dreaming_status|profile_buckets)" does not exist/.test(text)
    || /relation "dreaming_job" does not exist/.test(text)
    || (/Failed query:/.test(text) && /"(dreaming_status|profile_buckets)"/.test(text));
}

function redactSecrets(text) {
  return text.replace(/sm_[A-Za-z0-9_-]{20,}/g, "sm_[redacted]");
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
