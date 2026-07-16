import { homedir } from "node:os";
import { runGate } from "./gate.js";
import { runTrust } from "./trust.js";

const ACTIONS = new Set(["pre-action", "pre-compact", "stop"]);

export async function runSession(options = {}) {
  const action = options.action ?? "pre-action";
  if (!ACTIONS.has(action)) {
    throw new Error("Unknown session action. Use: smctl session pre-action|pre-compact|stop");
  }
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25
  };

  if (action === "pre-action") return preAction(context);
  if (action === "pre-compact") return preCompact(context);
  return stop(context);
}

async function preAction(context) {
  const gate = await runGate(context);
  const result = {
    command: "session pre-action",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    hook: "pre-action",
    decision: gate.decision,
    score: gate.score,
    blockers: gate.blockers,
    warnings: gate.warnings,
    next: gate.next,
    gate: {
      exitCode: gate.exitCode,
      smartSections: gate.smartSections
    },
    exitCode: gate.exitCode
  };
  result.text = formatPreAction(result);
  return result;
}

async function preCompact(context) {
  const trust = await runTrust(context);
  const result = {
    command: "session pre-compact",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    hook: "pre-compact",
    trust: {
      score: trust.score,
      summary: trust.summary,
      next: trust.next
    },
    contract: compactionContract(),
    next: trust.next[0] ?? "smctl trust",
    exitCode: trust.exitCode
  };
  result.text = formatPreCompact(result);
  return result;
}

async function stop(context) {
  const trust = await runTrust(context);
  const result = {
    command: "session stop",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    hook: "stop",
    trust: {
      score: trust.score,
      summary: trust.summary,
      next: trust.next
    },
    next: trust.exitCode === 0 ? "smctl verify" : trust.next[0] ?? "smctl repair wizard",
    exitCode: trust.exitCode
  };
  result.text = formatStop(result);
  return result;
}

function compactionContract() {
  return [
    "Literal user request and success condition",
    "Files touched, commands run, tests run, commits and pushes",
    "Rejected approaches, failed attempts, and negative constraints",
    "Supermemory trust state, project scope, and recall warnings",
    "Remaining work and smallest safe next step"
  ];
}

function formatPreAction(result) {
  const lines = [];
  lines.push("Supermemory Harness session pre-action");
  lines.push(`Decision: ${result.decision.status.toUpperCase()} - ${result.decision.label}`);
  lines.push(`Memory score: ${result.score.value}/100 (${result.score.label})`);
  lines.push(result.decision.detail);
  if (result.blockers.length > 0) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of result.blockers.slice(0, 4)) {
      lines.push(`   ${blocker.title}`);
      if (blocker.detail) lines.push(`      ${blocker.detail}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings.slice(0, 4)) {
      lines.push(`   ${warning.title}`);
      if (warning.detail) lines.push(`      ${warning.detail}`);
    }
  }
  lines.push("");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function formatPreCompact(result) {
  const lines = [];
  lines.push("Supermemory Harness session pre-compact");
  lines.push(`Trust: ${result.trust.score.value}/100 (${result.trust.score.label})`);
  lines.push(`Summary: ${result.trust.summary.ok} ok, ${result.trust.summary.warn} warn, ${result.trust.summary.fail} fail`);
  lines.push("");
  lines.push("Preserve before compacting:");
  for (const item of result.contract) lines.push(`   - ${item}`);
  lines.push("");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function formatStop(result) {
  const lines = [];
  lines.push("Supermemory Harness session stop");
  lines.push(`Trust: ${result.trust.score.value}/100 (${result.trust.score.label})`);
  lines.push(`Summary: ${result.trust.summary.ok} ok, ${result.trust.summary.warn} warn, ${result.trust.summary.fail} fail`);
  lines.push(result.exitCode === 0
    ? "Result: session can hand off with usable Supermemory state."
    : "Result: do not hand off as trusted memory until the next command is handled.");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
