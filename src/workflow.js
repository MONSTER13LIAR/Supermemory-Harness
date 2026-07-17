import { homedir } from "node:os";
import { runWatch } from "./watch.js";

const PAIN_POINTS = [
  {
    id: "setup-drift",
    title: "Setup drift",
    pain: "Supermemory can be installed but the coding-agent path is still not wired.",
    harness: "enhance checks Local, writes safe config, installs skills, connects agent bridge files, initializes project scope, and starts the embedded dashboard path when possible.",
    auto: "smctl enhance",
    boundary: "Writes only Harness-owned config and activation receipts; it does not hide secrets or delete memory."
  },
  {
    id: "invisible-runtime",
    title: "Invisible runtime state",
    pain: "Users see a server tab but cannot tell whether memory, MCP, agents, queue, and Guard are actually healthy.",
    harness: "supermemory start and watch put Harness health events into the Supermemory terminal and dashboard workflow.",
    auto: "smctl supermemory start",
    boundary: "Shows state in the existing flow instead of replacing the Supermemory server binary."
  },
  {
    id: "trust-gap",
    title: "Memory trust gap",
    pain: "Documents can exist while recall is stale, cross-project, duplicated, contradictory, vague, or missing memories.",
    harness: "trust, score, gate, repair, and Smart Sections turn memory state into a decision and next command.",
    auto: "smctl gate",
    boundary: "Blocks risky reliance; live proof only writes a harmless canary when the user asks for a probe."
  },
  {
    id: "unsafe-capture",
    title: "Unsafe automatic capture",
    pain: "Agent memory can persist secrets, noisy notes, or unreviewed context that should not become durable memory.",
    harness: "Guard reviews risky writes, redacts obvious secrets in output, and keeps pending approvals local.",
    auto: "smctl guard inbox",
    boundary: "High-risk writes require review instead of silent forwarding."
  },
  {
    id: "dream-opacity",
    title: "Dreaming opacity",
    pain: "Background processing and consolidation are hard to inspect, so users cannot tell what changed while they were away.",
    harness: "dreams snapshots processing state and shows new, completed, failed, disappeared, and changed documents.",
    auto: "smctl dreams",
    boundary: "Records local snapshots for visibility; it does not silently rewrite Supermemory memories."
  },
  {
    id: "repair-dead-end",
    title: "Repair dead end",
    pain: "When memory feels wrong, users are left guessing between server bugs, MCP mismatch, failed docs, queue backlog, or local store issues.",
    harness: "repair wizard turns diagnostics into an ordered, safe plan.",
    auto: "smctl repair wizard",
    boundary: "Plans by default; destructive cleanup is outside the normal flow."
  }
];

const MORAL_BOUNDARIES = [
  "Simple install is allowed to configure Harness-owned files and safe agent instructions.",
  "Risky memory writes, live proof writes, and any future destructive cleanup need explicit user intent.",
  "Secrets are redacted from output and are never printed as part of diagnostics.",
  "Harness should sit inside the Supermemory workflow, not pretend to be Supermemory or silently replace it.",
  "When memory cannot be trusted, the product must say that plainly and give the next command."
];

export async function runWorkflow(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 12
  };

  const watch = await runWatch(context);
  const stages = buildStages(watch);
  const result = {
    command: "workflow",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    tagline: "Install once, then Supermemory gets a status bar, guardrails, proof, repair, and migration paths.",
    current: summarizeCurrent(watch),
    stages,
    painPoints: PAIN_POINTS,
    moralBoundaries: MORAL_BOUNDARIES,
    next: chooseNext(stages, watch),
    exitCode: watch.exitCode
  };
  result.text = formatWorkflow(result);
  return result;
}

function buildStages(watch) {
  return [
    stage("1", "Install and activate", stageStatus(watch.local.status === "online" || watch.agents.configured > 0), "smctl enhance", "Make the common path automatic: setup, skills, bridge, project scope, UI proxy."),
    stage("2", "Run where users already look", watch.local.status === "online" ? "ready" : "blocked", "smctl supermemory start", "Put Harness health in the same terminal stream as Supermemory logs."),
    stage("3", "Check before relying on memory", watch.local.status === "online" ? "ready" : "blocked", "smctl gate", "Give Codex/Claude a pass, warn, or block decision before important edits/tests."),
    stage("4", "Review risky captures", watch.guard.pending > 0 ? "attention" : "ready", "smctl guard inbox", `${watch.guard.pending} pending write(s); high-risk writes should not silently persist.`),
    stage("5", "Watch processing and dreaming", watch.memory.queued > 0 || watch.memory.failed > 0 ? "attention" : "ready", "smctl dreams", `Queue ${watch.memory.queued}, failed ${watch.memory.failed}; make background memory changes visible.`),
    stage("6", "Repair only what is broken", needsRepair(watch) ? "attention" : "ready", "smctl repair wizard", watch.watchdog?.detail ?? "Use ordered diagnostics when recall or processing feels wrong.")
  ];
}

function summarizeCurrent(watch) {
  return {
    local: watch.local.status,
    mcp: watch.local.mcp.label,
    agents: `${watch.agents.configured}/${watch.agents.total}`,
    queue: watch.memory.queued,
    failed: watch.memory.failed,
    guard: watch.guard.pending,
    recommendedByWatch: watch.next
  };
}

function chooseNext(stages, watch) {
  const blocked = stages.find((item) => item.status === "blocked");
  if (blocked) return blocked.command;
  const attention = stages.find((item) => item.status === "attention");
  if (attention) return attention.command;
  return watch.next ?? "smctl verify";
}

function needsRepair(watch) {
  return watch.memory.failed > 0 || (watch.watchdog && watch.watchdog.status !== "ok");
}

function stage(id, title, status, command, detail) {
  return { id, title, status, command, detail };
}

function stageStatus(ready) {
  return ready ? "ready" : "attention";
}

function formatWorkflow(result) {
  const lines = [];
  lines.push("Supermemory Harness workflow");
  lines.push(result.tagline);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");
  lines.push("Current:");
  lines.push(`   Local ${result.current.local}; MCP ${result.current.mcp}; agents ${result.current.agents}; queue ${result.current.queue}; failed ${result.current.failed}; guard ${result.current.guard}`);
  lines.push("");
  lines.push("Visible Difference After Install:");
  lines.push("   Before: users had a Local server, raw logs, and agent memory behavior they had to trust blindly.");
  lines.push("   After: Harness shows readiness, blocks risky writes, proves recall, explains repair, and embeds the command center into the dashboard.");
  lines.push("");
  lines.push("Simple Workflow:");
  for (const stage of result.stages) {
    lines.push(`${symbol(stage.status)} ${stage.id}. ${stage.title}`);
    lines.push(`   ${stage.detail}`);
    lines.push(`   Command: ${stage.command}`);
  }
  lines.push("");
  lines.push("Real Gaps Covered:");
  for (const pain of result.painPoints) {
    lines.push(`- ${pain.title}: ${pain.harness}`);
  }
  lines.push("");
  lines.push("Moral Boundaries:");
  for (const boundary of result.moralBoundaries) {
    lines.push(`- ${boundary}`);
  }
  lines.push("");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}

function symbol(status) {
  if (status === "ready") return "[ok]";
  if (status === "blocked") return "[block]";
  return "[warn]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
