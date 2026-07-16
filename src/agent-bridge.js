import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { runSetup } from "./setup.js";
import { runTrust } from "./trust.js";

const AGENTS = new Set(["codex", "claude", "all"]);

export async function runAgentBridge(options = {}) {
  const action = options.action ?? "status";
  if (action === "connect") return connectAgents(options);
  if (action === "status") return bridgeStatus(options);
  throw new Error("Unknown agent action. Use: smctl agent connect <codex|claude|all> or smctl agent status");
}

async function connectAgents(options = {}) {
  const context = bridgeContext(options);
  const target = options.target ?? "all";
  if (!AGENTS.has(target)) {
    throw new Error(`Unsupported agent target: ${target}`);
  }
  const targets = target === "all" ? ["codex", "claude"] : [target];

  const setup = await safeResult(() => runSetup({
    baseUrl: context.baseUrl,
    home: context.home,
    dryRun: context.dryRun,
    target: "all"
  }));
  const trust = await runTrust({
    baseUrl: context.baseUrl,
    home: context.home,
    cwd: context.cwd,
    fetch: context.fetch,
    limit: 25
  });

  const actions = [];
  for (const agent of targets) {
    actions.push(await writeAgentBridge(agent, context, trust));
  }

  const summary = summarize(actions);
  const result = {
    command: "agent connect",
    generatedAt: new Date().toISOString(),
    target,
    baseUrl: context.baseUrl,
    dryRun: context.dryRun,
    setup: setup.error ? { exitCode: 1, error: setup.error } : { exitCode: setup.exitCode, summary: setup.summary },
    trust: { score: trust.score, summary: trust.summary, next: trust.next },
    actions,
    summary,
    exitCode: summary.failed > 0 ? 1 : 0
  };
  result.text = formatConnect(result);
  return result;
}

async function bridgeStatus(options = {}) {
  const context = bridgeContext(options);
  const paths = {
    codex: codexBridgePath(context.home),
    claude: claudeBridgePath(context.home)
  };
  const statuses = [];
  for (const [agent, path] of Object.entries(paths)) {
    const content = await readText(path);
    statuses.push({
      agent,
      path,
      connected: Boolean(content),
      detail: content ? "Harness bridge instructions installed" : "Not installed"
    });
  }
  const result = {
    command: "agent status",
    generatedAt: new Date().toISOString(),
    statuses,
    exitCode: statuses.some((status) => status.connected) ? 0 : 1
  };
  result.text = formatStatus(result);
  return result;
}

async function safeResult(fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: error.message, exitCode: 1 };
  }
}

async function writeAgentBridge(agent, context, trust) {
  const path = agent === "codex" ? codexBridgePath(context.home) : claudeBridgePath(context.home);
  const content = bridgeInstructions(agent, context, trust);
  if (context.dryRun) {
    return {
      status: "planned",
      agent,
      path,
      detail: "Would write Harness agent bridge instructions"
    };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  return {
    status: "connected",
    agent,
    path,
    detail: "Harness agent bridge instructions installed"
  };
}

function bridgeInstructions(agent, context, trust) {
  return `# Supermemory Harness Agent Bridge

This file teaches ${agent} how to communicate with Supermemory Harness.

## Contract

- Before relying on memory, run: smctl trust --json
- Before risky edits, tests, migrations, or dependency changes, run: smctl session pre-action
- Before compacting context, run: smctl session pre-compact
- Before ending or handing off a session, run: smctl session stop
- If the user asks whether Supermemory is healthy, run: smctl trust
- If memory feels wrong, run: smctl repair wizard
- If the user wants a live proof, run: smctl trust --probe
- Use project-scoped Supermemory memory whenever an active project profile exists.
- Do not ask the user to inspect Supermemory logs first; run Harness diagnostics and summarize the result.
- Before compacting, summarizing, or handing off a long coding session, preserve the Harness compaction contract below and store the result as project-scoped memory when possible.

## Harness Compaction Contract

When context is getting large, preserve these fields exactly and do not replace them with a vague progress summary:

- Literal user request: the user's actual goal and wording when it affects implementation.
- End state: what must be true when the work is done.
- Files touched: paths changed, tests added, commands run, commits made, and pushes completed.
- Negative constraints: things the user forbade, approaches rejected, and failed attempts.
- Memory decisions: project scope, container tag, relevant prior memories, and any recall/trust warnings.
- Remaining work: blockers, next command, and the smallest safe continuation step.

If any of those fields are unknown, write "unknown" instead of inventing it.

## Hookable Commands

- Pre-action gate: smctl session pre-action --json
- Pre-compact contract: smctl session pre-compact --json
- Stop/handoff check: smctl session stop --json
- Manual trust doctor: smctl trust --json
- Repair plan: smctl repair wizard --json

## Current Supermemory Target

- Base URL: ${context.baseUrl}
- Last Trust score at bridge install: ${trust.score.value}/100 (${trust.score.label})
- Last Trust summary: ${trust.summary.ok} ok, ${trust.summary.warn} warn, ${trust.summary.fail} fail
- Next commands: ${trust.next.length ? trust.next.join(", ") : "none"}

## User-facing Summary Rule

When reporting Supermemory state, say the result plainly:

- "Supermemory is healthy enough to rely on."
- "Supermemory is reachable but has warnings."
- "Do not rely on Supermemory yet; Harness found failing trust checks."

Then list the exact next command.
`;
}

function bridgeContext(options) {
  return {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    dryRun: Boolean(options.dryRun)
  };
}

function codexBridgePath(home) {
  return join(home, ".codex", "harness", "supermemory-bridge.md");
}

function claudeBridgePath(home) {
  return join(home, ".claude", "harness", "supermemory-bridge.md");
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function summarize(actions) {
  return actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, { connected: 0, planned: 0, failed: 0 });
}

function formatConnect(result) {
  const lines = [];
  lines.push("Supermemory Harness agent bridge");
  lines.push(`Target: ${result.target}`);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Mode: ${result.dryRun ? "dry-run" : "write"}`);
  lines.push(`Trust: ${result.trust.score.value}/100 (${result.trust.score.label})`);
  lines.push("");
  for (const action of result.actions) {
    lines.push(`${symbol(action.status)} ${action.agent}`);
    lines.push(`   ${action.path}`);
    lines.push(`   ${action.detail}`);
  }
  lines.push("");
  lines.push("Agent instruction:");
  lines.push("   Ask Codex or Claude Code to run smctl trust before relying on Supermemory.");
  return lines.join("\n");
}

function formatStatus(result) {
  const lines = [];
  lines.push("Supermemory Harness agent bridge status");
  for (const status of result.statuses) {
    lines.push(`${status.connected ? "[ok]" : "[warn]"} ${status.agent}`);
    lines.push(`   ${status.path}`);
    lines.push(`   ${status.detail}`);
  }
  return lines.join("\n");
}

function symbol(status) {
  if (status === "connected") return "[ok]";
  if (status === "planned") return "[plan]";
  return "[fail]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
