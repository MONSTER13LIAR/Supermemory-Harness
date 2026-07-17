import { homedir } from "node:os";
import { runAgentBridge } from "./agent-bridge.js";
import { runDreams } from "./dreams.js";
import { runSession } from "./session.js";
import { runTrust } from "./trust.js";
import { runWatch } from "./watch.js";

export async function runExecutive(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25
  };

  const [watch, trust, dreams, session, agents] = await Promise.all([
    runWatch(context),
    runTrust(context),
    runDreams({ ...context, dryRun: true }),
    runSession({ ...context, action: "pre-action" }),
    runAgentBridge({ action: "status", home: context.home })
  ]);

  const board = buildBoard({ watch, trust, dreams, session, agents });
  const actions = prioritizeActions({ watch, trust, dreams, session, agents });
  const readiness = summarizeReadiness(board, actions);
  const result = {
    command: "executive",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    readiness,
    board,
    actions,
    finalChecks: finalChecks(),
    sources: {
      watch: { exitCode: watch.exitCode, next: watch.next },
      trust: { exitCode: trust.exitCode, score: trust.score, summary: trust.summary, next: trust.next },
      dreams: { exitCode: dreams.exitCode, state: dreams.state, next: dreams.next },
      session: { exitCode: session.exitCode, decision: session.decision, next: session.next },
      agents: { exitCode: agents.exitCode, statuses: agents.statuses }
    },
    exitCode: readiness.status === "block" ? 1 : 0
  };
  result.text = formatExecutive(result);
  return result;
}

function buildBoard({ watch, trust, dreams, session, agents }) {
  const connectedAgents = agents.statuses.filter((status) => status.connected).length;
  return [
    card("runtime", "Runtime", watch.local.status === "online" ? "ready" : "block", `Local ${watch.local.status}; MCP ${watch.local.mcp.label}; queue ${watch.memory.queued}; failed ${watch.memory.failed}.`),
    card("trust", "Trust", trust.exitCode === 0 ? "ready" : "block", `${trust.score.value}/100 (${trust.score.label}); ${trust.summary.fail} fail, ${trust.summary.warn} warn.`),
    card("autopilot", "Agent Autopilot", session.exitCode === 0 ? "ready" : "block", `${session.decision.status.toUpperCase()} - ${session.decision.label}.`),
    card("dreams", "Dream Flight", dreams.exitCode === 0 && dreams.diff.failed.length === 0 ? "ready" : "attention", `${dreams.state.label}; new ${dreams.diff.newDocuments.length}, completed ${dreams.diff.completed.length}, failed ${dreams.diff.failed.length}.`),
    card("guard", "Guard Review", watch.guard.pending === 0 ? "ready" : "attention", `${watch.guard.pending} pending; high risk ${watch.guard.risk.high}.`),
    card("agents", "Agent Bridge", connectedAgents > 0 ? "ready" : "attention", `${connectedAgents}/${agents.statuses.length} bridge instruction file(s) installed.`)
  ];
}

function prioritizeActions({ watch, trust, dreams, session, agents }) {
  const actions = [];
  if (watch.local.status !== "online") actions.push(action("Start Supermemory through Harness", "smctl supermemory start", "Local runtime is the foundation for every other memory check."));
  if (agents.statuses.every((status) => !status.connected)) actions.push(action("Install agent lifecycle bridge", "smctl agent connect all", "Agents should know to run Harness before relying on memory."));
  if (session.exitCode !== 0) actions.push(action("Resolve pre-action memory gate", session.next, session.decision.detail));
  if (trust.exitCode !== 0) actions.push(action("Repair trust blockers", trust.next[0] ?? "smctl repair wizard", trust.score.detail));
  if (watch.guard.pending > 0) actions.push(action("Review pending memory writes", "smctl guard inbox", "Risky captures should not silently become durable memory."));
  if (dreams.diff.failed.length > 0) actions.push(action("Repair failed dream documents", "smctl repair wizard", `${dreams.diff.failed.length} failed document(s) detected in the flight recorder.`));
  if (actions.length === 0) actions.push(action("Run final live proof", "smctl trust --probe", "Write and recall a harmless marker before a demo or hosted release."));
  return dedupeActions(actions).slice(0, 5);
}

function summarizeReadiness(board, actions) {
  const blocks = board.filter((item) => item.status === "block").length;
  const attention = board.filter((item) => item.status === "attention").length;
  if (blocks > 0) {
    return {
      status: "block",
      label: "Not ready for serious Supermemory reliance",
      detail: `${blocks} blocking area(s); start with ${actions[0]?.command ?? "smctl workflow"}.`
    };
  }
  if (attention > 0) {
    return {
      status: "attention",
      label: "Usable with review",
      detail: `${attention} area(s) need review before a polished demo or hosted release.`
    };
  }
  return {
    status: "ready",
    label: "Ready for daily Supermemory use",
    detail: "No blocking Harness area found in the executive check."
  };
}

function finalChecks() {
  return [
    "npm test",
    "smctl executive",
    "smctl workflow",
    "smctl launch",
    "smctl session pre-action",
    "smctl trust --probe"
  ];
}

function card(id, title, status, detail) {
  return { id, title, status, detail };
}

function action(title, command, reason) {
  return { title, command, reason };
}

function dedupeActions(actions) {
  const seen = new Set();
  const out = [];
  for (const item of actions) {
    const key = item.command;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function formatExecutive(result) {
  const lines = [];
  lines.push("Supermemory Harness Executive Check");
  lines.push(`Readiness: ${result.readiness.status.toUpperCase()} - ${result.readiness.label}`);
  lines.push(result.readiness.detail);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");
  lines.push("Executive Board:");
  for (const item of result.board) {
    lines.push(`${symbol(item.status)} ${item.title}`);
    lines.push(`   ${item.detail}`);
  }
  lines.push("");
  lines.push("Action Plan:");
  for (const item of result.actions) {
    lines.push(`- ${item.title}: ${item.command}`);
    lines.push(`   ${item.reason}`);
  }
  lines.push("");
  lines.push("Final Checks Before Hosting:");
  for (const check of result.finalChecks) lines.push(`   ${check}`);
  return lines.join("\n");
}

function symbol(status) {
  if (status === "ready") return "[ok]";
  if (status === "block") return "[block]";
  return "[warn]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
