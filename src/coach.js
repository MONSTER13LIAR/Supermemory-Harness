import { analyzeMemory } from "./insights.js";
import { appendExplanation, explainHarnessResult } from "./local-brain.js";

export async function runMemoryCoach(options = {}) {
  const analysis = await analyzeMemory(options);
  const result = {
    command: "memory coach",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    score: analysis.score,
    sampled: analysis.documents.sampled,
    strengths: strengths(analysis),
    improvements: improvements(analysis),
    examples: examples(analysis),
    next: analysis.next,
    exitCode: analysis.issues.some((issue) => issue.status === "fail") ? 1 : 0
  };
  result.text = formatCoach(result);
  if (options.explain) {
    result.explanation = await explainHarnessResult(result, {
      fetch: options.fetch,
      ollamaModel: options.ollamaModel
    });
    result.text = appendExplanation(result.text, result.explanation);
  }
  return result;
}

function strengths(analysis) {
  const items = [];
  if (analysis.documents.done > 0) items.push(`${analysis.documents.done} completed writes in the sample`);
  if (analysis.profile) items.push(`Active project profile: ${analysis.profile.name}`);
  if (analysis.topContainers.length > 0) items.push(`${analysis.topContainers.length} container(s) are being used`);
  if (items.length === 0) items.push("Harness can reach the memory inventory");
  return items;
}

function improvements(analysis) {
  const items = [];
  if (analysis.documents.failed.length > 0) items.push("Fix failed writes before adding more memories.");
  if (analysis.quality.risky.length > 0) items.push("Remove or rewrite memories that may contain secrets.");
  if (analysis.quality.vague.length > 0) items.push("Rewrite vague memories with project, decision, owner, and reason.");
  if (analysis.quality.duplicates.length > 0) items.push("Merge duplicate-looking memories so recall does not return noisy context.");
  if (analysis.quality.missingProject.length > 0) items.push("Route future writes through Guard so project tags are consistent.");
  if (analysis.quality.zeroMemoryContainers.length > 0) items.push("Verify recall for containers that have documents but no listed memory entries.");
  if (items.length === 0) items.push("Keep using Guard and verify recall after large imports.");
  return items;
}

function examples(analysis) {
  const raw = [
    ...analysis.quality.vague,
    ...analysis.quality.missingProject,
    ...analysis.documents.failed
  ];
  return raw.slice(0, 5);
}

function formatCoach(result) {
  const lines = [];
  lines.push("Supermemory Harness memory coach");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Quality: ${result.score.value}/100 (${result.score.label})`);
  lines.push(`Sample: ${result.sampled} documents`);
  lines.push("");

  lines.push("Working well:");
  for (const item of result.strengths) lines.push(`   ${item}`);
  lines.push("");

  lines.push("Improve next:");
  for (const item of result.improvements) lines.push(`   ${item}`);

  if (result.examples.length > 0) {
    lines.push("");
    lines.push("Examples to review:");
    for (const item of result.examples) {
      lines.push(`   ${item.id}  ${item.title}`);
    }
  }

  if (result.next.length > 0) {
    lines.push("");
    lines.push(`Recommended: ${result.next[0]}`);
  }

  lines.push("");
  lines.push("Result: coach review complete. No memories were changed.");
  return lines.join("\n");
}
