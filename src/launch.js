import { homedir } from "node:os";
import { runExecutive } from "./executive.js";
import { runMigrate } from "./migrate.js";
import { runWorkflow } from "./workflow.js";

export async function runLaunch(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    cloudUrl: options.cloudUrl,
    cloudApiKeyEnv: options.cloudApiKeyEnv,
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25
  };

  const [executive, workflow, migration] = await Promise.all([
    safeResult(() => runExecutive(context)),
    safeResult(() => runWorkflow(context)),
    safeResult(() => runMigrate({
      action: "doctor",
      baseUrl: context.baseUrl,
      cloudUrl: context.cloudUrl,
      cloudApiKeyEnv: context.cloudApiKeyEnv,
      home: context.home,
      env: context.env,
      fetch: context.fetch,
      limit: context.limit,
      redact: true
    }))
  ]);

  const board = buildLaunchBoard({ executive, workflow, migration });
  const score = scoreLaunch({ executive, workflow, migration, board });
  const recommendation = recommendationFor(score, board);
  const proofChecklist = buildProofChecklist({ executive, workflow, migration });
  const demoScript = buildDemoScript({ executive, workflow, migration, proofChecklist });
  const expertBrief = buildExpertBrief({ executive, workflow, migration, recommendation });
  const next = chooseNext({ executive, workflow, migration, proofChecklist });

  const result = {
    command: "launch",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    cloudUrl: migration.cloudUrl ?? context.cloudUrl ?? "https://api.supermemory.ai",
    recommendation,
    score,
    board,
    proofChecklist,
    demoScript,
    expertBrief,
    next,
    sources: {
      executive: compactSource(executive),
      workflow: compactSource(workflow),
      migration: compactSource(migration)
    },
    exitCode: recommendation.status === "block" ? 1 : 0
  };
  result.text = formatLaunch(result);
  return result;
}

function buildLaunchBoard({ executive, workflow, migration }) {
  const trustScore = executive.sources?.trust?.score?.value ?? (executive.readiness?.status === "ready" ? 85 : 40);
  const configuredAgents = parseConfiguredAgents(workflow.current?.agents);
  const migrationScore = migration.readiness?.score ?? 0;
  const blockedStages = (workflow.stages ?? []).filter((stage) => stage.status === "blocked").length;
  const attentionStages = (workflow.stages ?? []).filter((stage) => stage.status === "attention").length;
  const firstAction = executive.actions?.[0];

  return [
    boardItem(
      "first-minute",
      "First-minute user value",
      workflow.current?.local === "online" || configuredAgents > 0 ? "ok" : "block",
      workflow.current?.local === "online"
        ? "Local is online and Harness can show visible runtime state immediately."
        : configuredAgents > 0
          ? "Agent bridge is installed, but Local should be started for the full experience."
          : "Start with smctl enhance or smctl supermemory start so users see value immediately."
    ),
    boardItem(
      "trust",
      "AI memory trust",
      trustScore >= 80 && executive.readiness?.status !== "block" ? "ok" : trustScore >= 55 ? "warn" : "block",
      `Trust signal ${trustScore}/100; ${executive.readiness?.label ?? "executive check unavailable"}.`
    ),
    boardItem(
      "safety",
      "Safety and control",
      workflow.current?.guard > 0 ? "warn" : "ok",
      workflow.current?.guard > 0
        ? `${workflow.current.guard} guarded write(s) need review before demo.`
        : "Guard inbox is clear and risky writes stay reviewable."
    ),
    boardItem(
      "recovery",
      "Recovery path",
      firstAction ? (executive.readiness?.status === "block" ? "warn" : "ok") : "ok",
      firstAction
        ? `${firstAction.command}: ${firstAction.title}.`
        : "No blocking recovery action is first in line."
    ),
    boardItem(
      "cloud",
      "Local-to-cloud path",
      migrationScore >= 80 ? "ok" : migrationScore >= 55 ? "warn" : "block",
      `Migration readiness ${migrationScore}/100 (${migration.readiness?.label ?? "unknown"}).`
    ),
    boardItem(
      "demo",
      "Demo script clarity",
      blockedStages === 0 ? "ok" : "warn",
      blockedStages === 0
        ? `${attentionStages} workflow stage(s) need review, but the path is presentable.`
        : `${blockedStages} workflow stage(s) block the clean demo path.`
    )
  ];
}

function scoreLaunch({ executive, workflow, migration, board }) {
  let value = 100;
  const executiveStatus = executive.readiness?.status;
  if (executiveStatus === "block") value -= 30;
  if (executiveStatus === "attention") value -= 12;
  const trustScore = executive.sources?.trust?.score?.value;
  if (Number.isFinite(trustScore)) value -= Math.round((100 - trustScore) / 4);
  const blockedStages = (workflow.stages ?? []).filter((stage) => stage.status === "blocked").length;
  const attentionStages = (workflow.stages ?? []).filter((stage) => stage.status === "attention").length;
  value -= blockedStages * 12;
  value -= attentionStages * 5;
  const migrationScore = migration.readiness?.score;
  if (Number.isFinite(migrationScore)) value -= Math.round((100 - migrationScore) / 5);
  for (const item of board) {
    if (item.status === "block") value -= 10;
    if (item.status === "warn") value -= 4;
  }
  value = Math.max(0, Math.min(100, value));
  return {
    value,
    label: value >= 90 ? "Hackathon-ready" : value >= 75 ? "Strong finalist" : value >= 55 ? "Promising but conditional" : "Not launch-ready",
    detail: value >= 90
      ? "The harness has visible value, trust controls, recovery, and a cloud story ready for a serious demo."
      : "The harness has the right product shape, but the launch board found issues to clear before a winning demo."
  };
}

function recommendationFor(score, board) {
  const blocking = board.filter((item) => item.status === "block");
  if (score.value >= 85 && blocking.length === 0) {
    return {
      status: "recommend",
      label: "Recommend",
      detail: "An AI coding assistant could recommend this as a practical Supermemory Local companion for agent memory."
    };
  }
  if (score.value >= 60) {
    return {
      status: "conditional",
      label: "Recommend after fixes",
      detail: `Clear ${blocking.length} blocking launch signal(s), then run smctl trust --probe for proof.`
    };
  }
  return {
    status: "block",
    label: "Do not recommend yet",
    detail: "The product shape is strong, but the current local state would disappoint users until the blocking checks are fixed."
  };
}

function buildProofChecklist({ executive, workflow, migration }) {
  const list = [];
  list.push(check("install", "Install delta", "smctl enhance --dry-run", workflow.exitCode === 0 ? "ok" : "warn", "Shows what the plugin wires into the user flow."));
  list.push(check("launch", "Launch board", "smctl launch", executive.exitCode === 0 ? "ok" : "warn", "Shows recommendation, score, proof, and next command."));
  list.push(check("trust", "Trust proof", "smctl trust --probe", executive.sources?.trust?.exitCode === 0 ? "ready" : "needed", "Writes and recalls a harmless marker only when explicitly requested."));
  list.push(check("repair", "Repair clarity", "smctl repair wizard", executive.actions?.some((item) => /repair|doctor|start/i.test(item.command)) ? "needed" : "ok", "Explains exactly what must be fixed before trusting recall."));
  list.push(check("cloud", "Cloud story", "smctl migrate doctor --redact", migration.exitCode === 0 ? "ok" : "warn", `Cloud readiness ${migration.readiness?.score ?? 0}/100.`));
  return list;
}

function buildDemoScript({ proofChecklist }) {
  return [
    {
      title: "Show the before/after",
      command: "smctl workflow",
      talkTrack: "Supermemory Local becomes a visible agent-memory workflow: status, safety, proof, repair, and cloud migration."
    },
    {
      title: "Run the launch board",
      command: "smctl launch",
      talkTrack: "One command tells a judge whether the plugin is recommendable and what still blocks a perfect demo."
    },
    {
      title: "Prove memory, not vibes",
      command: "smctl trust --probe",
      talkTrack: "The probe writes a harmless canary and proves recall, project scoping, and search before agents rely on memory."
    },
    {
      title: "Show safe recovery",
      command: proofChecklist.find((item) => item.id === "repair")?.command ?? "smctl repair wizard",
      talkTrack: "If Local is broken, Harness gives the next safe command instead of looping on failed writes."
    },
    {
      title: "Show the cloud path",
      command: "smctl migrate doctor --redact",
      talkTrack: "Users can see what is ready for Supermemory Cloud, what is held, and why secrets stay protected."
    }
  ];
}

function buildExpertBrief({ executive, workflow, migration, recommendation }) {
  return [
    `Recommendation: ${recommendation.label}. ${recommendation.detail}`,
    `For Codex/Claude: run smctl gate before important edits and smctl trust --probe before relying on recalled project facts.`,
    `For users: ${workflow.tagline ?? "install once, then use the Harness commands for status, safety, proof, and repair."}`,
    `For Supermemory: this complements Local by making runtime health, agent wiring, repair, and migration visible without taking ownership of secrets.`,
    `Cloud migration: ${migration.readiness?.label ?? "unknown"} at ${migration.readiness?.score ?? 0}/100.`,
    `Current executive state: ${executive.readiness?.label ?? "unknown"}.`
  ];
}

function chooseNext({ executive, workflow, migration, proofChecklist }) {
  const blockedBoardCommand = executive.actions?.[0]?.command;
  if (executive.readiness?.status === "block" && blockedBoardCommand) return blockedBoardCommand;
  const blockedStage = (workflow.stages ?? []).find((stage) => stage.status === "blocked");
  if (blockedStage) return blockedStage.command;
  const neededProof = proofChecklist.find((item) => ["needed", "warn"].includes(item.status));
  if (neededProof) return neededProof.command;
  if (migration.exitCode !== 0) return migration.readiness?.next?.[0] ?? "smctl migrate doctor --redact";
  return "smctl trust --probe";
}

function formatLaunch(result) {
  const lines = [];
  lines.push("Supermemory Harness launch board");
  lines.push(`Recommendation: ${result.recommendation.label}`);
  lines.push(`Launch score: ${result.score.value}/100 (${result.score.label})`);
  lines.push(result.score.detail);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");
  lines.push("Why it can win:");
  lines.push("- Makes Supermemory Local visibly better in the first minute after install.");
  lines.push("- Turns agent memory trust into checks, scores, gates, and proof instead of hope.");
  lines.push("- Gives judges a clean recovery story when Local, MCP, processing, or migration are broken.");
  lines.push("- Keeps safety explicit: risky writes and live proof writes need user intent.");
  lines.push("");
  lines.push("Launch Board:");
  for (const item of result.board) {
    lines.push(`${symbol(item.status)} ${item.title}`);
    lines.push(`   ${item.detail}`);
  }
  lines.push("");
  lines.push("Proof Checklist:");
  for (const item of result.proofChecklist) {
    lines.push(`${symbol(item.status)} ${item.title}: ${item.command}`);
    lines.push(`   ${item.detail}`);
  }
  lines.push("");
  lines.push("Judge Demo Script:");
  result.demoScript.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title}`);
    lines.push(`   Command: ${step.command}`);
    lines.push(`   ${step.talkTrack}`);
  });
  lines.push("");
  lines.push("AI Expert Brief:");
  for (const line of result.expertBrief) lines.push(`- ${line}`);
  lines.push("");
  lines.push(`Recommended next command: ${result.next}`);
  lines.push(result.exitCode === 0
    ? "Result: launch story is recommendable."
    : "Result: fix the blocking launch checks before the final demo.");
  return lines.join("\n");
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

function compactSource(result) {
  return {
    command: result.command,
    exitCode: result.exitCode,
    error: result.error,
    readiness: result.readiness,
    score: result.score,
    next: result.next
  };
}

function boardItem(id, title, status, detail) {
  return { id, title, status, detail };
}

function check(id, title, command, status, detail) {
  return {
    id,
    title,
    command,
    status,
    detail
  };
}

function parseConfiguredAgents(value) {
  if (typeof value !== "string") return 0;
  const [configured] = value.split("/");
  const number = Number(configured);
  return Number.isFinite(number) ? number : 0;
}

function symbol(status) {
  if (["ok", "ready"].includes(status)) return "[ok]";
  if (status === "block") return "[block]";
  return "[warn]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
