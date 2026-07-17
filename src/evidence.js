import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { runAdvisor } from "./advisor.js";
import { runGenome } from "./genome.js";
import { normalizeBaseUrl } from "./insights.js";
import { runLaunch } from "./launch.js";
import { runRecommend } from "./recommend.js";
import { runWorkflow } from "./workflow.js";

const SECRET_PATTERNS = [
  /\bsm_[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]{8,}/gi,
  /BEGIN (RSA |OPENSSH |EC |)?PRIVATE KEY[\s\S]*?END (RSA |OPENSSH |EC |)?PRIVATE KEY/g
];

export async function runEvidence(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    cloudUrl: options.cloudUrl,
    cloudApiKeyEnv: options.cloudApiKeyEnv,
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25,
    dryRun: Boolean(options.dryRun),
    now: options.now ?? new Date().toISOString()
  };
  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");

  const [advisor, recommend, launch, workflow, genome] = await Promise.all([
    safeResult(() => runAdvisor({ ...context, explain: false })),
    safeResult(() => runRecommend(context)),
    safeResult(() => runLaunch(context)),
    safeResult(() => runWorkflow(context)),
    safeResult(() => runGenome(context))
  ]);

  const evidence = sanitizeEvidence({
    command: "evidence",
    generatedAt: context.now,
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    dryRun: context.dryRun,
    summary: buildSummary({ advisor, recommend, launch, workflow, genome }),
    proofPoints: buildProofPoints({ advisor, recommend, launch, workflow, genome }),
    blockers: buildBlockers({ advisor, recommend, launch, workflow, genome }),
    demoCommands: buildDemoCommands({ advisor, recommend, launch, genome }),
    architecture: workflow.architecture ?? advisor.communicationPaths ?? [],
    llama: advisor.llamaUse ?? {
      status: "unknown",
      rule: "Use Llama for explanations only; deterministic Harness checks remain authoritative."
    },
    sources: {
      advisor: summarizeAdvisor(advisor),
      recommend: summarizeRecommend(recommend),
      launch: summarizeLaunch(launch),
      workflow: summarizeWorkflow(workflow),
      genome: summarizeGenome(genome)
    },
    next: chooseNext({ advisor, recommend, launch, workflow, genome })
  }, context);

  const report = formatEvidence(evidence);
  const writtenPath = context.dryRun ? evidencePath(context.home, context.now) : await writeEvidencePack(context.home, context.now, evidence, report);
  const result = {
    ...evidence,
    path: redact(writtenPath, context),
    text: report,
    exitCode: evidence.summary.blockers > 0 ? 1 : 0
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

async function writeEvidencePack(home, now, evidence, report) {
  const path = evidencePath(home, now);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${report}\n\n---\n\n${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function evidencePath(home, now) {
  const stamp = now.replace(/[:.]/g, "-");
  return join(home, ".config", "smctl", "evidence", `${stamp}.md`);
}

function buildSummary({ advisor, recommend, launch, workflow, genome }) {
  const statuses = [advisor, recommend, launch, workflow, genome].map((item) => item.exitCode === 0 ? "ok" : "attention");
  const blockers = countBlocks(advisor) + countBlocks(launch) + (recommend.recommendation?.status === "block" ? 1 : 0);
  const warnings = countWarnings(advisor) + countWarnings(launch) + (genome.exitCode === 0 ? 0 : 1);
  return {
    verdict: advisor.verdict?.label ?? launch.recommendation?.label ?? "Evidence generated",
    detail: advisor.verdict?.detail ?? launch.recommendation?.detail ?? "Harness generated a redacted evidence pack.",
    readiness: launch.score ? `${launch.score.value}/100 (${launch.score.label})` : "unknown",
    recommendation: recommend.recommendation?.label ?? "unknown",
    genome: genome.score ? `${genome.mode?.title ?? "Memory"} ${genome.score.value}/100` : genome.error ?? "unknown",
    checksOk: statuses.filter((status) => status === "ok").length,
    checksTotal: statuses.length,
    blockers,
    warnings
  };
}

function buildProofPoints({ advisor, recommend, launch, workflow, genome }) {
  const points = [];
  addPoint(points, "Operating plan", "smctl advisor", advisor.verdict?.label, advisor.verdict?.detail);
  addPoint(points, "Must-have product case", "smctl recommend", recommend.score ? `${recommend.score.value}/100 (${recommend.score.label})` : recommend.recommendation?.label, recommend.recommendation?.detail);
  addPoint(points, "Launch board", "smctl launch", launch.score ? `${launch.score.value}/100 (${launch.score.label})` : launch.recommendation?.label, launch.score?.detail);
  addPoint(points, "User-flow architecture", "smctl workflow", workflow.tagline, workflow.next ? `Next command: ${workflow.next}` : workflow.error);
  addPoint(points, "Memory Genome", "smctl genome", genome.score ? `${genome.mode?.title ?? "Memory"} ${genome.score.value}/100` : genome.policyState, genome.next ? `Next command: ${asCommand(genome.next)}` : genome.error);

  for (const feature of (recommend.features ?? []).slice(0, 10)) {
    points.push({
      title: feature.title,
      command: feature.command,
      status: feature.status,
      detail: feature.whyUsersCare
    });
  }
  return points;
}

function addPoint(points, title, command, status, detail) {
  points.push({
    title,
    command,
    status: status ?? "unknown",
    detail: detail ?? "No detail available."
  });
}

function buildBlockers({ advisor, recommend, launch, workflow, genome }) {
  const blockers = [];
  for (const point of advisor.weakPoints ?? []) {
    if (point.status !== "ok") {
      blockers.push({
        severity: point.status === "block" ? "block" : "warn",
        title: point.title,
        detail: point.detail,
        command: point.command
      });
    }
  }
  for (const item of launch.board ?? []) {
    if (item.status !== "ok") {
      blockers.push({
        severity: item.status === "block" ? "block" : "warn",
        title: item.title,
        detail: item.detail,
        command: launch.next
      });
    }
  }
  for (const stage of workflow.stages ?? []) {
    if (stage.status !== "ready") {
      blockers.push({
        severity: stage.status === "blocked" ? "block" : "warn",
        title: stage.title,
        detail: stage.detail,
        command: stage.command
      });
    }
  }
  if (recommend.recommendation?.status === "block") {
    blockers.push({
      severity: "block",
      title: recommend.recommendation.label,
      detail: recommend.recommendation.detail,
      command: recommend.next
    });
  }
  if (genome.exitCode !== 0) {
    blockers.push({
      severity: genome.reachable === false ? "warn" : "block",
      title: "Memory Genome needs attention",
      detail: genome.error ?? genome.score?.detail ?? "Genome could not produce a clean personalization signal.",
      command: asCommand(genome.next) ?? "smctl genome"
    });
  }
  return dedupeBlockers(blockers).slice(0, 12);
}

function buildDemoCommands({ advisor, recommend, launch, genome }) {
  return [
    { command: "smctl evidence", reason: "Generate this redacted proof pack for judges, users, or maintainers." },
    { command: "smctl advisor", reason: advisor.verdict?.detail ?? "Show the operating plan and first blocker." },
    { command: "smctl recommend", reason: recommend.recommendation?.detail ?? "Show the must-have product case." },
    { command: "smctl launch", reason: launch.recommendation?.detail ?? "Show launch score, proof checklist, and demo script." },
    { command: "smctl genome", reason: genome.score ? `Show Memory Genome at ${genome.score.value}/100.` : "Show personalization readiness." },
    { command: "smctl trust --probe", reason: "Opt-in live recall proof when Local is online." }
  ];
}

function chooseNext({ advisor, recommend, launch, workflow, genome }) {
  return advisor.next
    ?? launch.next
    ?? recommend.next
    ?? workflow.next
    ?? asCommand(genome.next)
    ?? "smctl launch";
}

function summarizeAdvisor(result) {
  return {
    exitCode: result.exitCode,
    verdict: result.verdict,
    next: result.next,
    weakPoints: (result.weakPoints ?? []).map((point) => ({
      status: point.status,
      title: point.title,
      detail: point.detail,
      command: point.command
    })),
    llamaUse: result.llamaUse,
    error: result.error
  };
}

function summarizeRecommend(result) {
  return {
    exitCode: result.exitCode,
    recommendation: result.recommendation,
    score: result.score,
    next: result.next,
    features: (result.features ?? []).map((feature) => ({
      id: feature.id,
      title: feature.title,
      status: feature.status,
      command: feature.command,
      proof: feature.proof
    })),
    error: result.error
  };
}

function summarizeLaunch(result) {
  return {
    exitCode: result.exitCode,
    recommendation: result.recommendation,
    score: result.score,
    next: result.next,
    board: (result.board ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      detail: item.detail
    })),
    proofChecklist: result.proofChecklist,
    error: result.error
  };
}

function summarizeWorkflow(result) {
  return {
    exitCode: result.exitCode,
    tagline: result.tagline,
    current: result.current,
    next: result.next,
    hurdles: result.hurdles,
    error: result.error
  };
}

function summarizeGenome(result) {
  return {
    exitCode: result.exitCode,
    reachable: result.reachable,
    score: result.score,
    mode: result.mode,
    policyState: result.policyState,
    next: result.next,
    gaps: result.gaps,
    error: result.error
  };
}

function countBlocks(result) {
  return (result.weakPoints ?? result.board ?? []).filter((item) => item.status === "block").length;
}

function countWarnings(result) {
  return (result.weakPoints ?? result.board ?? []).filter((item) => item.status === "warn").length;
}

function asCommand(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function dedupeBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((item) => {
    const key = `${item.severity}:${item.title}:${item.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeEvidence(value, context) {
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
  if (context.home) output = output.split(context.home).join("~");
  return output;
}

function formatEvidence(evidence) {
  const lines = [];
  lines.push("Supermemory Harness evidence pack");
  lines.push(`Generated: ${evidence.generatedAt}`);
  lines.push(`Base URL: ${evidence.baseUrl}`);
  lines.push(`CWD: ${evidence.cwd}`);
  lines.push(`Verdict: ${evidence.summary.verdict}`);
  lines.push(evidence.summary.detail);
  lines.push(`Readiness: ${evidence.summary.readiness}`);
  lines.push(`Checks: ${evidence.summary.checksOk}/${evidence.summary.checksTotal} clean; blockers ${evidence.summary.blockers}; warnings ${evidence.summary.warnings}`);
  lines.push("");

  lines.push("Why This Should Win:");
  lines.push("- It makes Supermemory Local visibly useful in the first minute: advisor, launch board, dashboard proxy, and agent bridge.");
  lines.push("- It turns memory into governed agent infrastructure: trust gate, Guard, recall proof, repair, and Memory Genome personalization.");
  lines.push("- It respects Local's privacy promise: deterministic local checks, redacted reports, opt-in live proof, and local Llama explanations only.");
  lines.push("- It creates a real adoption path: use Local safely, repair it when broken, and review what is ready for Cloud.");
  lines.push("");

  lines.push("Proof Points:");
  for (const point of evidence.proofPoints.slice(0, 15)) {
    lines.push(`${statusToken(point.status)} ${point.title} (${point.command})`);
    lines.push(`   ${point.detail}`);
  }
  lines.push("");

  lines.push("Demo Commands:");
  for (const item of evidence.demoCommands) {
    lines.push(`- ${item.command}`);
    lines.push(`   ${item.reason}`);
  }
  lines.push("");

  lines.push("Architecture Evidence:");
  if (evidence.architecture.length === 0) {
    lines.push("   No architecture data available.");
  } else {
    for (const path of evidence.architecture.slice(0, 8)) {
      if (typeof path === "string") {
        lines.push(`- ${path}`);
      } else {
        lines.push(`- ${path.name}: ${path.flow}`);
        if (path.command) lines.push(`   Command: ${path.command}`);
        if (path.risk) lines.push(`   Hurdle: ${path.risk}`);
      }
    }
  }
  lines.push("");

  lines.push("Local Llama Rule:");
  lines.push(`   Status: ${evidence.llama.status ?? "unknown"}${evidence.llama.model ? ` (${evidence.llama.model})` : ""}`);
  lines.push(`   ${evidence.llama.rule ?? "Use Llama for explanations only; deterministic checks remain authoritative."}`);
  lines.push("");

  lines.push("Current Blockers:");
  if (evidence.blockers.length === 0) {
    lines.push("   none");
  } else {
    for (const item of evidence.blockers) {
      lines.push(`${item.severity === "block" ? "[block]" : "[warn]"} ${item.title}`);
      lines.push(`   ${item.detail}`);
      if (item.command) lines.push(`   Fix: ${item.command}`);
    }
  }
  lines.push("");

  lines.push(`Recommended next command: ${evidence.next}`);
  lines.push(evidence.dryRun
    ? "Dry run: no evidence file was written."
    : "Saved as a redacted local report under ~/.config/smctl/evidence/.");
  lines.push("Secrets and home-directory paths are redacted.");
  return lines.join("\n");
}

function statusToken(status) {
  if (["ready", "ok", "recommend"].includes(status)) return "[ok]";
  if (["block", "blocked"].includes(status)) return "[block]";
  if (["warn", "attention", "conditional"].includes(status)) return "[warn]";
  return "[info]";
}
