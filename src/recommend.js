import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { runAudit } from "./audit.js";
import { runBackup } from "./backup.js";
import { runLaunch } from "./launch.js";

export async function runRecommend(options = {}) {
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

  const [launch, audit, backup, repo] = await Promise.all([
    safeResult(() => runLaunch(context)),
    safeResult(() => runAudit({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    safeResult(() => runBackup({
      home: context.home,
      dryRun: true
    })),
    inspectRepoEvidence(context.cwd)
  ]);

  const features = buildMustHaveFeatures({ launch, audit, backup, repo });
  const userFlow = buildUserFlow({ launch });
  const expertView = buildExpertView({ launch, audit, backup, repo, features });
  const developerView = buildDeveloperView({ launch, audit, backup, repo, features });
  const score = scoreRecommendation({ launch, audit, backup, repo, features });
  const recommendation = recommendationFor(score, features);
  const next = chooseNext({ launch, audit, features });

  const result = {
    command: "recommend",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    recommendation,
    score,
    features,
    userFlow,
    expertView,
    developerView,
    next,
    sources: {
      launch: compactSource(launch),
      audit: compactSource(audit),
      backup: compactSource(backup),
      repo
    },
    exitCode: recommendation.status === "block" ? 1 : 0
  };
  result.text = formatRecommend(result);
  return result;
}

function buildMustHaveFeatures({ launch, audit, backup, repo }) {
  const feature = (id, title, status, command, whyUsersCare, whySupermemoryCare, proof) => ({
    id,
    title,
    status,
    command,
    whyUsersCare,
    whySupermemoryCare,
    proof
  });

  const launchStatus = launch.recommendation?.status === "recommend"
    ? "ready"
    : launch.recommendation?.status === "conditional" ? "warn" : "block";
  const auditStatus = audit.exitCode === 0 ? "ready" : audit.exitCode === 1 ? "warn" : "block";
  const backupStatus = backup.exitCode === 0 ? "ready" : "warn";
  const ciStatus = repo.ci ? "ready" : "warn";
  const docsStatus = repo.submissionRunbook && repo.readme ? "ready" : "warn";
  const safety = findBoardStatus(launch, "safety", "ready");
  const recovery = findBoardStatus(launch, "recovery", "warn");
  const cloud = findBoardStatus(launch, "cloud", "warn");
  const trust = findBoardStatus(launch, "trust", "block");
  const runtime = findBoardStatus(launch, "first-minute", "block");

  return [
    feature(
      "one-command-activation",
      "One-command activation",
      docsStatus,
      "smctl enhance",
      "A new user gets setup, agent bridge instructions, project scope, and UI path from one command.",
      "It reduces Supermemory Local onboarding friction without replacing the Local server.",
      repo.readme ? "README documents the install-to-launch flow." : "README flow evidence missing."
    ),
    feature(
      "launch-board",
      "Recommendation launch board",
      launchStatus,
      "smctl launch",
      "Users and judges get a verdict, score, proof checklist, demo script, and next command.",
      "It makes product readiness measurable instead of subjective.",
      launch.recommendation?.detail ?? "Launch board unavailable."
    ),
    feature(
      "agent-memory-gate",
      "Agent memory gate",
      trust === "ready" ? "ready" : trust === "warn" ? "warn" : "block",
      "smctl gate",
      "Agents get a pass/warn/block decision before risky edits or memory reliance.",
      "It turns Supermemory memory into governed agent infrastructure, not only storage.",
      boardDetail(launch, "trust")
    ),
    feature(
      "live-recall-proof",
      "Live recall proof",
      proofStatus(launch),
      "smctl trust --probe",
      "A harmless canary proves write, search, project scope, and recall before a demo.",
      "It demonstrates retrieval quality, the core of useful memory.",
      proofDetail(launch, "trust")
    ),
    feature(
      "runtime-visibility",
      "Runtime visibility",
      runtime,
      "smctl watch",
      "Users see Local, MCP, agents, queue, dreaming, Guard, and next action at a glance.",
      "It makes Local support and debugging easier because hidden state becomes observable.",
      boardDetail(launch, "first-minute")
    ),
    feature(
      "dream-flight-recorder",
      "Dream Flight Recorder",
      auditStatus,
      "smctl dreams",
      "Background memory changes become reviewable instead of mysterious.",
      "It gives Dynamic Dreaming-style behavior an operator review surface.",
      audit.exitCode === 0 ? "Audit passed; dreaming/retrieval checks are usable." : "Audit found issues that should be reviewed."
    ),
    feature(
      "safe-repair",
      "Safe repair and guarded replay",
      recovery === "ready" ? "ready" : "warn",
      "smctl repair wizard",
      "Broken processing, failed writes, and replay paths produce ordered next steps.",
      "It prevents Supermemory users from retrying into a broken Local runtime.",
      boardDetail(launch, "recovery")
    ),
    feature(
      "cloud-migration",
      "Reviewed Local-to-Cloud migration",
      cloud === "ready" ? "ready" : cloud === "warn" ? "warn" : "block",
      "smctl migrate doctor --redact",
      "Useful local memories can move cloudward with held-item review and secret redaction.",
      "It turns Local into a trusted staging environment instead of a dead-end sandbox.",
      boardDetail(launch, "cloud")
    ),
    feature(
      "privacy-support",
      "Privacy-safe support and backup",
      backupStatus,
      "smctl support && smctl backup --dry-run",
      "Users can collect debug context and backups without exposing API keys or auth secrets.",
      "It makes support safer for maintainers and users.",
      backup.exitCode === 0 ? "Backup dry-run completed." : backup.error ?? "Backup dry-run needs attention."
    ),
    feature(
      "submission-evidence",
      "Submission-grade evidence",
      ciStatus,
      "npm test",
      "The project has tests, CI, and a judge runbook instead of only claims.",
      "It gives Supermemory maintainers confidence this can be recommended responsibly.",
      repo.ci ? "GitHub Actions workflow exists." : "CI workflow missing."
    )
  ];
}

function buildUserFlow({ launch }) {
  return [
    flowStep("1", "Install and activate", "smctl enhance", "Sets up the visible Supermemory Local companion path."),
    flowStep("2", "Open the verdict", "smctl recommend", "Shows the must-have reasons, blockers, and recommended next command."),
    flowStep("3", "Run the launch board", "smctl launch", "Gives a judge-ready score, proof checklist, and demo script."),
    flowStep("4", "Use agents safely", "smctl gate", "Checks whether memory is trustworthy before important edits/tests."),
    flowStep("5", "Prove memory live", "smctl trust --probe", "Writes and recalls a harmless marker when the user wants proof."),
    flowStep("6", "Fix only what is broken", launch.next ?? "smctl repair wizard", "Uses the current diagnostics to choose the safest repair or start command."),
    flowStep("7", "Move useful memory forward", "smctl migrate doctor --redact", "Reviews Local-to-Cloud readiness without leaking secrets.")
  ];
}

function buildExpertView({ launch, audit, backup, repo, features }) {
  const blockers = features.filter((item) => item.status === "block").length;
  return [
    `Recommendation signal: ${launch.recommendation?.label ?? "unknown"}; ${blockers} blocking feature area(s).`,
    "As a senior AI engineer, I would recommend this when the live recall proof and gate pass because it treats memory as an operational dependency, not a passive vector store.",
    "The strongest technical argument is retrieval governance: project scope, source grounding, failed-write visibility, repair ordering, and opt-in canary proof.",
    `Audit state: ${audit.exitCode === 0 ? "usable" : "needs attention"}. Backup dry-run: ${backup.exitCode === 0 ? "available" : "needs attention"}.`,
    `Evidence state: CI ${repo.ci ? "present" : "missing"}, submission runbook ${repo.submissionRunbook ? "present" : "missing"}.`
  ];
}

function buildDeveloperView({ launch, features }) {
  const ready = features.filter((item) => item.status === "ready").length;
  return [
    `For Supermemory developers, Harness is complementary: it wraps Local with diagnostics and user flow instead of replacing the server.`,
    "It lowers support load by converting MCP, processing, schema, failed-write, queue, and migration problems into exact user-facing next commands.",
    "It respects product boundaries: setup and diagnostics are automatic, while risky writes, live proof writes, and destructive cleanup remain explicit.",
    "It creates an adoption loop: better Local trust creates better memories, and reviewed migration moves durable memories toward Cloud.",
    `${ready}/10 must-have feature areas are currently ready in this environment; the rest are visible blockers rather than hidden failures.`,
    `Current launch next command: ${launch.next ?? "smctl launch"}.`
  ];
}

function scoreRecommendation({ launch, audit, backup, repo, features }) {
  let value = launch.score?.value ?? 60;
  for (const item of features) {
    if (item.status === "ready") value += 3;
    if (item.status === "warn") value -= 3;
    if (item.status === "block") value -= 10;
  }
  if (audit.exitCode === 0) value += 4;
  else value -= 4;
  if (backup.exitCode === 0) value += 3;
  if (repo.ci) value += 4;
  if (repo.submissionRunbook) value += 4;
  value = Math.max(0, Math.min(100, value));
  return {
    value,
    label: value >= 90 ? "Must-have companion" : value >= 75 ? "Recommendable companion" : value >= 55 ? "Promising but fix first" : "Not recommendable yet",
    detail: value >= 90
      ? "The plugin is strong enough to recommend as the default operational companion for Supermemory Local."
      : "The plugin has a strong product argument, but the current environment still has blockers to clear before a must-have recommendation."
  };
}

function recommendationFor(score, features) {
  const blockers = features.filter((item) => item.status === "block");
  if (score.value >= 88 && blockers.length === 0) {
    return {
      status: "recommend",
      label: "Recommend as a must-have",
      detail: "A senior AI engineer and Supermemory developer could recommend this as the operational layer that makes Local safer to use with agents."
    };
  }
  if (score.value >= 60) {
    return {
      status: "conditional",
      label: "Recommend after live blockers are fixed",
      detail: `The feature set is strong; clear ${blockers.length} blocking live area(s) and rerun smctl trust --probe.`
    };
  }
  return {
    status: "block",
    label: "Do not recommend yet",
    detail: "The current live state would undermine the user experience until the blocking checks are fixed."
  };
}

function chooseNext({ launch, audit, features }) {
  const blocked = features.find((item) => item.status === "block");
  if (launch.next) return launch.next;
  if (blocked) return blocked.command;
  if (audit.exitCode !== 0) return "smctl audit";
  return "smctl trust --probe";
}

function formatRecommend(result) {
  const lines = [];
  lines.push("Supermemory Harness recommendation pack");
  lines.push(`Recommendation: ${result.recommendation.label}`);
  lines.push(`Must-have score: ${result.score.value}/100 (${result.score.label})`);
  lines.push(result.score.detail);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("");
  lines.push("Ten Features That Make This A Must With Supermemory Local:");
  for (const feature of result.features) {
    lines.push(`${symbol(feature.status)} ${feature.title}`);
    lines.push(`   Command: ${feature.command}`);
    lines.push(`   User value: ${feature.whyUsersCare}`);
    lines.push(`   Supermemory value: ${feature.whySupermemoryCare}`);
    lines.push(`   Proof: ${feature.proof}`);
  }
  lines.push("");
  lines.push("Better User Flow:");
  for (const step of result.userFlow) {
    lines.push(`${step.number}. ${step.title}`);
    lines.push(`   Command: ${step.command}`);
    lines.push(`   ${step.detail}`);
  }
  lines.push("");
  lines.push("Senior AI Expert View:");
  for (const item of result.expertView) lines.push(`- ${item}`);
  lines.push("");
  lines.push("Supermemory Developer View:");
  for (const item of result.developerView) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`Recommended next command: ${result.next}`);
  lines.push(result.exitCode === 0
    ? "Result: recommendable as a Supermemory Local companion."
    : "Result: do not recommend until the blocking live checks are fixed.");
  return lines.join("\n");
}

async function inspectRepoEvidence(cwd) {
  const [ci, readme, submissionRunbook] = await Promise.all([
    exists(join(cwd, ".github", "workflows", "test.yml")),
    exists(join(cwd, "README.md")),
    exists(join(cwd, "docs", "hackathon-submission.md"))
  ]);
  return { ci, readme, submissionRunbook };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
    recommendation: result.recommendation,
    score: result.score,
    next: result.next
  };
}

function findBoardStatus(launch, id, fallback) {
  const item = launch.board?.find((entry) => entry.id === id);
  if (!item) return fallback;
  if (item.status === "ok") return "ready";
  return item.status;
}

function boardDetail(launch, id) {
  return launch.board?.find((entry) => entry.id === id)?.detail ?? "No launch-board detail available.";
}

function proofStatus(launch) {
  const trust = launch.proofChecklist?.find((item) => item.id === "trust");
  if (!trust) return "warn";
  if (["ok", "ready"].includes(trust.status)) return "ready";
  if (trust.status === "needed") return "warn";
  return trust.status;
}

function proofDetail(launch, id) {
  return launch.proofChecklist?.find((item) => item.id === id)?.detail ?? "Proof checklist unavailable.";
}

function flowStep(number, title, command, detail) {
  return { number, title, command, detail };
}

function symbol(status) {
  if (status === "ready") return "[ok]";
  if (status === "block") return "[block]";
  return "[warn]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
