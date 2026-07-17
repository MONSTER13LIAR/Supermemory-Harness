import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { runDoctor } from "./doctor.js";
import { runDreams } from "./dreams.js";
import { migrateDoctor } from "./migrate.js";
import { runTrust } from "./trust.js";
import { runWatch } from "./watch.js";

const SECRET_PATTERNS = [
  /\bsm_[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,
  /BEGIN (RSA |OPENSSH |EC |)?PRIVATE KEY[\s\S]*?END (RSA |OPENSSH |EC |)?PRIVATE KEY/g
];

export async function runSupport(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25,
    dryRun: Boolean(options.dryRun),
    now: options.now ?? new Date().toISOString()
  };

  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");

  const [doctor, watch, trust, dreams, migration, logs] = await Promise.all([
    safeResult(() => runDoctor({
      baseUrl: context.baseUrl,
      cwd: context.cwd,
      env: context.env,
      home: context.home,
      fetch: context.fetch
    })),
    safeResult(() => runWatch({
      baseUrl: context.baseUrl,
      cwd: context.cwd,
      env: context.env,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    safeResult(() => runTrust({
      baseUrl: context.baseUrl,
      cwd: context.cwd,
      env: context.env,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    safeResult(() => runDreams({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit,
      dryRun: true,
      now: context.now
    })),
    safeResult(() => migrateDoctor({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    readLogHints(context.home)
  ]);

  const bundle = sanitizeBundle({
    command: "support",
    generatedAt: context.now,
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    node: process.version,
    platform: process.platform,
    dryRun: context.dryRun,
    summary: supportSummary({ doctor, watch, trust, dreams, migration }),
    doctor: summarizeDoctor(doctor),
    watch: summarizeWatch(watch),
    trust: summarizeTrust(trust),
    dreams: summarizeDreams(dreams),
    migration: summarizeMigration(migration),
    logs
  }, context);

  const report = formatSupport(bundle);
  const writtenPath = context.dryRun ? supportPath(context.home, context.now) : await writeSupportBundle(context.home, context.now, bundle, report);
  const result = {
    ...bundle,
    path: redact(writtenPath, context),
    text: report,
    exitCode: bundle.summary.fail > 0 ? 1 : 0
  };
  return result;
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

async function readLogHints(home) {
  try {
    const content = await readFile(join(home, ".supermemory", "server.log"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /error|failed|retry|mcp|memory|dream|queue|oom|port/i.test(line))
      .slice(-30);
  } catch {
    return [];
  }
}

async function writeSupportBundle(home, now, bundle, report) {
  const path = supportPath(home, now);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${report}\n\n---\n\n${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function supportPath(home, now) {
  const stamp = now.replace(/[:.]/g, "-");
  return join(home, ".config", "smctl", "support", `${stamp}.md`);
}

function supportSummary({ doctor, watch, trust, dreams, migration }) {
  const checks = [doctor, watch, trust, dreams, migration];
  return checks.reduce((acc, item) => {
    if (item.exitCode === 0) acc.ok += 1;
    else acc.fail += 1;
    return acc;
  }, { ok: 0, fail: 0 });
}

function summarizeDoctor(result) {
  return {
    exitCode: result.exitCode,
    summary: result.summary,
    checks: (result.checks ?? []).map((check) => ({
      status: check.status,
      title: check.title,
      detail: check.detail
    })).slice(0, 20),
    error: result.error
  };
}

function summarizeWatch(result) {
  return {
    exitCode: result.exitCode,
    bar: result.bar,
    local: result.local,
    agents: result.agents,
    memory: result.memory,
    guard: result.guard,
    watchdog: result.watchdog,
    next: result.next,
    error: result.error
  };
}

function summarizeTrust(result) {
  return {
    exitCode: result.exitCode,
    score: result.score,
    decision: result.decision,
    summary: result.summary,
    checks: (result.checks ?? []).slice(0, 20),
    next: result.next,
    error: result.error
  };
}

function summarizeDreams(result) {
  return {
    exitCode: result.exitCode,
    state: result.state,
    current: result.current,
    diff: result.diff ? {
      newDocuments: result.diff.newDocuments?.length ?? 0,
      completed: result.diff.completed?.length ?? 0,
      failed: result.diff.failed?.length ?? 0,
      disappeared: result.diff.disappeared?.length ?? 0,
      contentChanged: result.diff.contentChanged?.length ?? 0,
      containerChanged: result.diff.containerChanged?.length ?? 0,
      highRisk: result.diff.highRisk?.length ?? 0
    } : null,
    next: result.next,
    error: result.error
  };
}

function summarizeMigration(result) {
  return {
    exitCode: result.exitCode,
    readiness: result.readiness,
    summary: result.plan?.summary,
    error: result.error
  };
}

function sanitizeBundle(value, context) {
  return JSON.parse(redact(JSON.stringify(value, null, 2), context));
}

function redact(text, context) {
  let output = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, label) => {
      if (label) return `${label}=[REDACTED]`;
      return "[REDACTED]";
    });
  }
  if (context.home) {
    output = output.split(context.home).join("~");
  }
  return output;
}

function formatSupport(bundle) {
  const lines = [];
  lines.push("Supermemory Harness support bundle");
  lines.push(`Generated: ${bundle.generatedAt}`);
  lines.push(`Base URL: ${bundle.baseUrl}`);
  lines.push(`CWD: ${bundle.cwd}`);
  lines.push(`Runtime: ${bundle.node} on ${bundle.platform}`);
  lines.push(`Summary: ${bundle.summary.ok} ok, ${bundle.summary.fail} need attention`);
  lines.push("");
  section(lines, "Doctor", bundle.doctor.exitCode, doctorDetail(bundle.doctor));
  section(lines, "Harness Bar", bundle.watch.exitCode, bundle.watch.next || bundle.watch.error || "No next action");
  section(lines, "Trust", bundle.trust.exitCode, bundle.trust.score ? `${bundle.trust.score.value}/100 (${bundle.trust.score.label})` : bundle.trust.error);
  section(lines, "Dream Flight", bundle.dreams.exitCode, bundle.dreams.state ? `${bundle.dreams.state.label}: ${bundle.dreams.state.detail}` : bundle.dreams.error);
  section(lines, "Cloud Migration", bundle.migration.exitCode, bundle.migration.readiness ? `${bundle.migration.readiness.score}/100 (${bundle.migration.readiness.label})` : bundle.migration.error);
  lines.push("");
  lines.push("Log hints:");
  if (bundle.logs.length === 0) {
    lines.push("   none");
  } else {
    for (const line of bundle.logs.slice(-10)) lines.push(`   ${line}`);
  }
  lines.push("");
  lines.push("Share this file when asking for help. Secrets and home paths are redacted.");
  return lines.join("\n");
}

function section(lines, title, exitCode, detail) {
  lines.push(`${exitCode === 0 ? "[ok]" : "[warn]"} ${title}`);
  lines.push(`   ${detail ?? "No detail"}`);
}

function doctorDetail(doctor) {
  if (doctor.error) return doctor.error;
  if (!doctor.summary) return "No doctor summary";
  return `${doctor.summary.ok} ok, ${doctor.summary.warn} warn, ${doctor.summary.fail} fail`;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
