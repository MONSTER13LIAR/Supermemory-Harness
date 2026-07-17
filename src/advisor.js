import { homedir } from "node:os";
import { runGenome } from "./genome.js";
import { runLaunch } from "./launch.js";
import { appendExplanation, explainHarnessResult, localBrainDoctor } from "./local-brain.js";
import { runWorkflow } from "./workflow.js";

export async function runAdvisor(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    cloudUrl: options.cloudUrl,
    cloudApiKeyEnv: options.cloudApiKeyEnv,
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25,
    ollamaModel: options.ollamaModel
  };

  const [workflow, launch, genome, brain] = await Promise.all([
    safeResult(() => runWorkflow(context)),
    safeResult(() => runLaunch(context)),
    safeResult(() => runGenome(context)),
    safeResult(() => localBrainDoctor({
      fetch: context.fetch,
      ollamaModel: context.ollamaModel,
      timeoutMs: 3000
    }))
  ]);

  const weakPoints = buildWeakPoints({ workflow, launch, genome, brain });
  const plan = buildPlan({ workflow, launch, genome, brain, weakPoints });
  const verdict = buildVerdict({ weakPoints, launch });
  const result = {
    command: "advisor",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    verdict,
    weakPoints,
    entryPaths: buildEntryPaths(),
    communicationPaths: buildCommunicationPaths(),
    llamaUse: buildLlamaUse(brain),
    plan,
    checks: weakPoints.map((point) => ({
      status: point.status === "ok" ? "ok" : point.status === "block" ? "fail" : "warn",
      title: point.title,
      detail: point.detail
    })),
    actions: plan.map((item) => ({
      title: item.title,
      detail: item.reason
    })),
    next: plan[0]?.command ?? "smctl workflow",
    sources: {
      workflow: compactSource(workflow),
      launch: compactSource(launch),
      genome: compactSource(genome),
      brain: compactSource(brain)
    },
    exitCode: verdict.status === "block" ? 1 : 0
  };
  result.text = formatAdvisor(result);

  if (options.explain !== false) {
    result.explanation = await explainHarnessResult(result, {
      fetch: context.fetch,
      ollamaModel: context.ollamaModel,
      timeoutMs: 8000
    });
    result.text = appendExplanation(result.text, result.explanation);
  }

  return result;
}

function buildWeakPoints({ workflow, launch, genome, brain }) {
  const points = [];
  const current = workflow.current ?? {};
  if (current.local !== "online") {
    points.push(block("Supermemory Local is not reachable", "Harness cannot prove memory quality until Local is online.", "smctl supermemory start"));
  } else {
    points.push(ok("Supermemory Local is reachable", "Harness can read Local runtime state."));
  }

  const agentsConfigured = parseConfigured(current.agents);
  if (agentsConfigured === 0) {
    points.push(warn("Agent bridge is not configured", "Codex/Claude may not run Harness lifecycle checks before relying on memory.", "smctl agent connect all"));
  }

  if (current.guard > 0) {
    points.push(warn("Guard has pending writes", `${current.guard} pending write(s) need review before a clean launch.`, "smctl guard inbox"));
  }

  const launchBlocks = launch.board?.filter((item) => item.status === "block") ?? [];
  if (launchBlocks.length > 0) {
    points.push(block("Launch board has blockers", launchBlocks.map((item) => item.title).join(", "), launch.next ?? "smctl launch"));
  } else if (launch.recommendation?.status === "conditional") {
    points.push(warn("Launch recommendation is conditional", launch.recommendation.detail, launch.next ?? "smctl launch"));
  }

  if (genome.reachable === false) {
    points.push(warn("Memory Genome cannot read memories", "Personalization policy cannot be trusted until the memory inventory is readable.", "smctl genome"));
  } else if (genome.policyState !== "installed") {
    points.push(warn("Memory Genome policy is not installed", "Guard can be more useful after applying the generated policy.", "smctl genome apply"));
  } else {
    points.push(ok("Memory Genome policy is installed", "Guard can personalize future writes."));
  }

  if (brain.exitCode !== 0) {
    points.push(warn("Local Llama is not ready", "Plain-English explanations will use deterministic fallback until Ollama/model is available.", "smctl brain doctor"));
  } else {
    points.push(ok("Local Llama is ready", "Harness can produce local plain-English explanations."));
  }

  return dedupePoints(points);
}

function buildPlan({ workflow, launch, genome, brain, weakPoints }) {
  const commands = [];
  const add = (title, command, reason) => {
    if (!command || commands.some((item) => item.command === command)) return;
    commands.push({ title, command, reason });
  };

  const firstBlock = weakPoints.find((point) => point.status === "block");
  if (firstBlock) add(firstBlock.title, firstBlock.command, firstBlock.detail);

  for (const point of weakPoints.filter((item) => item.status === "warn")) {
    add(point.title, point.command, point.detail);
  }

  if (workflow.current?.local === "online") {
    add("Open the local command center", "smctl ui", "Use Supermemory through the dashboard proxy with Harness visible.");
  }
  if (genome.exitCode === 0 && genome.policyState !== "installed") {
    add("Apply personalization", "smctl genome apply", "Let Guard use the user's actual memory shape.");
  }
  if (launch.recommendation?.status !== "block") {
    add("Run live recall proof", "smctl trust --probe", "Prove memory works with a harmless canary before demo or real reliance.");
  }
  if (brain.exitCode !== 0) {
    add("Check local Llama", "smctl brain doctor", "Local Llama is optional, but improves explanations when available.");
  }
  add("Re-run launch board", "smctl launch", "Confirm readiness after fixes.");

  return commands.slice(0, 6);
}

function buildVerdict({ weakPoints, launch }) {
  const blocks = weakPoints.filter((point) => point.status === "block").length;
  const warns = weakPoints.filter((point) => point.status === "warn").length;
  if (blocks > 0) {
    return {
      status: "block",
      label: "Fix before launch",
      detail: `${blocks} blocking point(s). ${launch.recommendation?.detail ?? "Start with the first advisor command."}`
    };
  }
  if (warns > 0) {
    return {
      status: "attention",
      label: "Useful with polish left",
      detail: `${warns} warning point(s). The product is useful, but the advisor path should be cleared before final submission.`
    };
  }
  return {
    status: "ready",
    label: "Ready to recommend",
    detail: "The core runtime, trust, personalization, safety, and explanation paths are present."
  };
}

function buildEntryPaths() {
  return [
    {
      user: "New user installing manually",
      command: "smctl enhance",
      outcome: "Sets up the Harness-owned files, dashboard proxy, agent bridge, project scope, and activation receipt."
    },
    {
      user: "Codex or Claude Code user",
      command: "smctl agent connect all",
      outcome: "Installs bridge instructions so the agent runs trust, session, Genome, and repair checks before relying on memory."
    },
    {
      user: "Daily Supermemory Local user",
      command: "smctl supermemory start",
      outcome: "Runs the normal server with Harness trust events in the same terminal stream."
    },
    {
      user: "Judge or Supermemory developer",
      command: "smctl advisor",
      outcome: "Shows the useful path, blockers, architecture, and exact next command from one place."
    }
  ];
}

function buildCommunicationPaths() {
  return [
    "Local HTTP: Harness reads Supermemory Local at localhost:6767 through documented dashboard/OpenAPI/document/search/profile routes.",
    "Guard proxy: apps and agents can send writes to localhost:6777 so Harness can review risk, add project/skill/Genome metadata, then forward approved writes.",
    "Dashboard proxy: localhost:6778 forwards the real Supermemory dashboard and injects the Harness command center.",
    "Agent bridge: Codex/Claude read local bridge instructions and call smctl lifecycle commands instead of guessing from raw logs.",
    "Local Llama: Ollama at localhost:11434 explains deterministic Harness results; it does not decide health or approve writes."
  ];
}

function buildLlamaUse(brain) {
  return {
    status: brain.exitCode === 0 ? "ready" : "fallback",
    model: brain.model,
    rule: "Use Llama for short explanations and user guidance only; deterministic checks remain authoritative.",
    fallback: "If Ollama or the model is missing, Harness generates deterministic plain-English explanations."
  };
}

function formatAdvisor(result) {
  const lines = [];
  lines.push("Supermemory Harness Advisor");
  lines.push(`Verdict: ${result.verdict.label}`);
  lines.push(result.verdict.detail);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");

  lines.push("Killer Weak Points:");
  for (const point of result.weakPoints) {
    lines.push(`${symbol(point.status)} ${point.title}`);
    lines.push(`   ${point.detail}`);
    if (point.command) lines.push(`   Fix: ${point.command}`);
  }
  lines.push("");

  lines.push("How Users Should Enter:");
  for (const path of result.entryPaths) {
    lines.push(`- ${path.user}: ${path.command}`);
    lines.push(`   ${path.outcome}`);
  }
  lines.push("");

  lines.push("How Harness Talks To Supermemory:");
  for (const path of result.communicationPaths) lines.push(`- ${path}`);
  lines.push("");

  lines.push("Local Llama Usage:");
  lines.push(`   Status: ${result.llamaUse.status}${result.llamaUse.model ? ` (${result.llamaUse.model})` : ""}`);
  lines.push(`   Rule: ${result.llamaUse.rule}`);
  lines.push(`   Fallback: ${result.llamaUse.fallback}`);
  lines.push("");

  lines.push("Operating Plan:");
  for (const [index, item] of result.plan.entries()) {
    lines.push(`${index + 1}. ${item.command}`);
    lines.push(`   ${item.reason}`);
  }
  lines.push("");
  lines.push(`Recommended next command: ${result.next}`);
  lines.push(result.exitCode === 0
    ? "Result: advisor path is clear enough for launch."
    : "Result: fix the first advisor blocker before launch.");
  return lines.join("\n");
}

function ok(title, detail, command) {
  return { status: "ok", title, detail, command };
}

function warn(title, detail, command) {
  return { status: "warn", title, detail, command };
}

function block(title, detail, command) {
  return { status: "block", title, detail, command };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "block") return "[block]";
  return "[warn]";
}

function parseConfigured(value) {
  if (typeof value !== "string") return 0;
  const [configured] = value.split("/");
  const number = Number(configured);
  return Number.isFinite(number) ? number : 0;
}

function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const point of points) {
    const key = `${point.title}:${point.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out;
}

function compactSource(result) {
  return {
    command: result.command,
    exitCode: result.exitCode,
    error: result.error,
    verdict: result.verdict,
    recommendation: result.recommendation,
    score: result.score,
    readiness: result.readiness,
    next: result.next
  };
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

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
