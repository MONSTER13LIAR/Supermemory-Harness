import { analyzeMemory, symbol } from "./insights.js";
import { attachSmartSections } from "./smart-sections.js";

export async function runGate(options = {}) {
  const analysis = await analyzeMemory(options);
  const blockers = analysis.issues.filter((issue) => issue.status === "fail");
  const warnings = analysis.issues.filter((issue) => issue.status === "warn");
  const decision = decideGate({ analysis, blockers, warnings });
  const result = {
    command: "gate",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    profile: analysis.profile,
    score: analysis.score,
    decision,
    blockers,
    warnings,
    next: gateNext(decision, analysis.next),
    exitCode: decision.status === "block" ? 1 : 0
  };
  result.text = formatGate(result);
  return attachSmartSections(result, options);
}

function decideGate({ analysis, blockers, warnings }) {
  if (!analysis.profile) {
    return {
      status: "block",
      label: "Initialize project memory first",
      detail: "No active project profile; edits/tests may read or write unscoped memory."
    };
  }
  if (blockers.length > 0) {
    return {
      status: "block",
      label: "Repair memory before relying on it",
      detail: "Harness found blocking memory health issues that can mislead the agent."
    };
  }
  if (warnings.some((issue) => /Contradictory|missing project|Duplicate|Vague/i.test(issue.title))) {
    return {
      status: "warn",
      label: "Proceed with memory warnings",
      detail: "Use memory, but carry the listed warnings into the edit/test plan."
    };
  }
  return {
    status: "pass",
    label: "Proceed",
    detail: "No blocking memory risks found in the sampled state."
  };
}

function gateNext(decision, next) {
  if (decision.status === "block") return next[0] ?? "smctl repair wizard";
  if (decision.status === "warn") return "Read warnings, then run the planned edit/test command";
  return "Proceed with the planned edit/test command";
}

function formatGate(result) {
  const lines = [];
  lines.push("Supermemory Harness pre-action gate");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Decision: ${result.decision.status.toUpperCase()} - ${result.decision.label}`);
  lines.push(`Memory score: ${result.score.value}/100 (${result.score.label})`);
  if (result.profile) {
    lines.push(`Project: ${result.profile.name} -> ${result.profile.containerTag}`);
  } else {
    lines.push("Project: none");
  }
  lines.push("");
  lines.push(result.decision.detail);

  if (result.blockers.length > 0) {
    lines.push("");
    lines.push("Blockers:");
    for (const issue of result.blockers.slice(0, 5)) {
      lines.push(`${symbol(issue.status)} ${issue.title}`);
      if (issue.detail) lines.push(`   ${issue.detail}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const issue of result.warnings.slice(0, 5)) {
      lines.push(`${symbol(issue.status)} ${issue.title}`);
      if (issue.detail) lines.push(`   ${issue.detail}`);
    }
  }

  lines.push("");
  lines.push(`Recommended: ${result.next}`);
  return lines.join("\n");
}
