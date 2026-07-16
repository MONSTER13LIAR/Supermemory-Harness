import { analyzeMemory, symbol } from "./insights.js";
import { attachSmartSections } from "./smart-sections.js";

export async function runScore(options = {}) {
  const analysis = await analyzeMemory(options);
  const result = {
    command: "score",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    score: analysis.score,
    issues: analysis.issues,
    next: analysis.next,
    documents: analysis.documents,
    summary: summarize(analysis.issues),
    exitCode: analysis.score.value < 40 || analysis.issues.some((issue) => issue.status === "fail") ? 1 : 0
  };
  result.text = formatScore(result);
  return attachSmartSections(result, options);
}

function formatScore(result) {
  const lines = [];
  lines.push("Supermemory Harness score");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Memory Recall Score: ${result.score.value}/100 (${result.score.label})`);
  lines.push(`Sample: ${result.documents.sampled} documents`);
  lines.push("");
  lines.push(result.score.detail);
  lines.push("");

  for (const issue of result.issues.slice(0, 6)) {
    lines.push(`${symbol(issue.status)} ${issue.title}`);
    if (issue.detail) lines.push(`   ${issue.detail}`);
  }

  if (result.next.length > 0) {
    lines.push("");
    lines.push(`Recommended: ${result.next[0]}`);
    for (const command of result.next.slice(1)) {
      lines.push(`   then ${command}`);
    }
  }

  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: memory score is usable."
    : "Result: memory score needs attention before trusting recall.");
  return lines.join("\n");
}

function summarize(issues) {
  return issues.reduce((acc, issue) => {
    acc[issue.status] = (acc[issue.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}
