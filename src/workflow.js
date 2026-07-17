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
    id: "personalization-gap",
    title: "Memory shape is invisible",
    pain: "Users may store coding decisions, personal notes, hardware logs, support context, and source material, but the product does not explain what kind of memory base they are building.",
    harness: "genome classifies stored memory types, checks profile-learning signals, generates a local personalization policy, and lets Guard apply it to future writes.",
    auto: "smctl genome",
    boundary: "It installs policy only after readable memory analysis; blocking memory quality issues stop apply."
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
  },
  {
    id: "demo-proof-gap",
    title: "Demo proof gap",
    pain: "A user, judge, or AI agent needs to know quickly whether the plugin is actually recommendable.",
    harness: "launch gives a recommendation verdict, launch score, proof checklist, demo script, and exact next command.",
    auto: "smctl launch",
    boundary: "Read-only by default; live proof remains opt-in through smctl trust --probe."
  }
];

const ARCHITECTURE_PATHS = [
  {
    name: "Self install path",
    flow: "User -> npm install / smctl enhance -> setup files, skills, bridge, project scope, dashboard proxy",
    command: "smctl enhance",
    risk: "Local server may be offline, running from the wrong folder, or missing provider/model config."
  },
  {
    name: "Codex / Claude Code path",
    flow: "Agent -> bridge instructions -> smctl session/gate/trust/genome -> Supermemory Local HTTP checks",
    command: "smctl agent connect all",
    risk: "Agents can forget to ask memory tools or rely on stale memory unless the bridge tells them the lifecycle commands."
  },
  {
    name: "Memory write path",
    flow: "App or agent -> Guard proxy :6777 -> review/risk/project/Genome metadata -> Supermemory Local :6767",
    command: "smctl start",
    risk: "Direct writes to :6767 bypass Guard review; use Guard for risky or agent-generated writes."
  },
  {
    name: "Dashboard path",
    flow: "Browser -> Harness UI proxy :6778 -> Supermemory dashboard :6767 plus /__smctl command-center routes",
    command: "smctl ui",
    risk: "The proxy is local-only and depends on Supermemory Local being reachable."
  },
  {
    name: "Terminal runtime path",
    flow: "smctl supermemory start -> starts supermemory-server from $HOME -> streams logs with Harness trust snapshots",
    command: "smctl supermemory start",
    risk: "Starting the server from a repo folder can create or use a project-local .supermemory store."
  },
  {
    name: "Local Llama path",
    flow: "smctl --explain / brain doctor -> Ollama :11434 -> short plain-English explanation with deterministic fallback",
    command: "smctl brain doctor",
    risk: "The model must explain diagnostics only; deterministic Harness checks remain the source of truth."
  }
];

const MORAL_BOUNDARIES = [
  "Simple install is allowed to configure Harness-owned files and safe agent instructions.",
  "Risky memory writes, live proof writes, and any future destructive cleanup need explicit user intent.",
  "Secrets are redacted from output and are never printed as part of diagnostics.",
  "Harness should sit inside the Supermemory workflow, not pretend to be Supermemory or silently replace it.",
  "Local Llama can explain Harness results, but it must not invent health state or override deterministic pass/warn/fail checks.",
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
    architecture: ARCHITECTURE_PATHS,
    stages,
    hurdles: buildHurdles(watch),
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
    stage("4", "Personalize memory behavior", watch.local.status === "online" ? "ready" : "blocked", "smctl genome", "Classify stored memories and apply a local policy so Guard knows what this user should remember or ignore."),
    stage("5", "Review risky captures", watch.guard.pending > 0 ? "attention" : "ready", "smctl guard inbox", `${watch.guard.pending} pending write(s); high-risk writes should not silently persist.`),
    stage("6", "Watch processing and dreaming", watch.memory.queued > 0 || watch.memory.failed > 0 ? "attention" : "ready", "smctl dreams", `Queue ${watch.memory.queued}, failed ${watch.memory.failed}; make background memory changes visible.`),
    stage("7", "Repair only what is broken", needsRepair(watch) ? "attention" : "ready", "smctl repair wizard", watch.watchdog?.detail ?? "Use ordered diagnostics when recall or processing feels wrong."),
    stage("8", "Launch with proof", watch.local.status === "online" ? "ready" : "blocked", "smctl launch", "Generate the final recommendation, score, proof checklist, and judge demo script.")
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

function buildHurdles(watch) {
  const hurdles = [];
  if (watch.local.status !== "online") {
    hurdles.push(hurdle("Local is offline", "Supermemory Local is not reachable on localhost:6767.", "smctl supermemory start"));
  }
  if (watch.local.mcp.label !== "ready") {
    hurdles.push(hurdle("MCP is not ready", watch.local.mcp.detail, "smctl doctor"));
  }
  if (watch.agents.configured === 0) {
    hurdles.push(hurdle("No coding agent bridge configured", "Codex/Claude may not know to run Harness lifecycle checks.", "smctl agent connect all"));
  }
  if (watch.memory.failed > 0) {
    hurdles.push(hurdle("Failed memory writes", `${watch.memory.failed} sampled write(s) failed or errored.`, "smctl repair wizard"));
  }
  if (watch.memory.queued > 0) {
    hurdles.push(hurdle("Processing is still catching up", `${watch.memory.queued} queued or processing write(s).`, "smctl watch"));
  }
  if (watch.guard.risk.high > 0) {
    hurdles.push(hurdle("High-risk guarded write", `${watch.guard.risk.high} high-risk write(s) are waiting for review.`, "smctl guard inbox"));
  }
  if (watch.watchdog && watch.watchdog.status !== "ok") {
    hurdles.push(hurdle("Repair watchdog warning", watch.watchdog.detail, "smctl repair wizard"));
  }
  hurdles.push(hurdle("Local Llama may be missing", "Llama is optional and should explain Harness results only; deterministic checks still decide pass/warn/fail.", "smctl brain doctor"));
  return hurdles.slice(0, 8);
}

function needsRepair(watch) {
  return watch.memory.failed > 0 || (watch.watchdog && watch.watchdog.status !== "ok");
}

function hurdle(title, detail, command) {
  return { title, detail, command };
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
  lines.push("Architecture Paths:");
  for (const path of result.architecture) {
    lines.push(`- ${path.name}`);
    lines.push(`   Flow: ${path.flow}`);
    lines.push(`   Command: ${path.command}`);
    lines.push(`   Hurdle: ${path.risk}`);
  }
  lines.push("");
  lines.push("Hurdles And Fixes:");
  for (const hurdle of result.hurdles) {
    lines.push(`- ${hurdle.title}: ${hurdle.detail}`);
    lines.push(`   Fix: ${hurdle.command}`);
  }
  lines.push("");
  lines.push("Local Llama Usage:");
  lines.push("   Use it for short plain-English explanations after deterministic Harness checks.");
  lines.push("   Do not use it to decide whether Supermemory is healthy, to approve writes, or to invent memory state.");
  lines.push("   If Ollama/model is missing, Harness falls back to deterministic explanations.");
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
