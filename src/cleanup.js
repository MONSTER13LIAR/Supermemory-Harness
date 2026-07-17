import { analyzeMemory } from "./insights.js";

export async function runCleanup(options = {}) {
  const analysis = await analyzeMemory(options);
  const result = {
    command: "cleanup",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    mode: "plan",
    duplicateGroups: analysis.quality.duplicates.slice(0, 8),
    risky: analysis.quality.risky.slice(0, 10),
    testMarkers: analysis.quality.testMarkers.slice(0, 10),
    vague: analysis.quality.vague.slice(0, 10),
    missingProject: analysis.quality.missingProject.slice(0, 10),
    missingAnchors: analysis.quality.missingAnchors.slice(0, 10),
    next: cleanupNext(analysis),
    exitCode: analysis.quality.risky.length > 0 ? 1 : 0
  };
  result.text = formatCleanup(result);
  return result;
}

function cleanupNext(analysis) {
  const next = [];
  if (analysis.quality.risky.length > 0) next.push("Review risky items in Supermemory before sharing or exporting memories.");
  if (analysis.quality.duplicates.length > 0) next.push("Merge duplicate-looking notes into one clearer memory.");
  if (analysis.quality.testMarkers.length > 0) next.push("Delete old smoke/verify test markers from Supermemory if you no longer need them.");
  if (analysis.quality.vague.length > 0) next.push("Rewrite vague memories with who, project, decision, and date.");
  if (analysis.quality.missingProject.length > 0) next.push("Run smctl start so future writes get project context automatically.");
  if (analysis.quality.missingAnchors.length > 0) next.push("Add source URLs, file paths, or migration IDs to important unanchored memories.");
  if (next.length === 0) next.push("No cleanup action needed in this sample.");
  return next;
}

function formatCleanup(result) {
  const lines = [];
  lines.push("Supermemory Harness cleanup");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push("Mode: plan only; no memories changed");
  lines.push("");

  section(lines, "Possible secrets", result.risky, (item) => `${item.id}  ${item.title}`);
  section(lines, "Duplicate-looking groups", result.duplicateGroups, (group) => `${group.count}x  ${group.key}`);
  section(lines, "Old Harness test markers", result.testMarkers, (item) => `${item.id}  ${item.title}`);
  section(lines, "Vague memories", result.vague, (item) => `${item.id}  ${item.title}`);
  section(lines, "Missing project context", result.missingProject, (item) => `${item.id}  ${item.title}`);
  section(lines, "Missing source anchors", result.missingAnchors, (item) => `${item.id}  ${item.title}`);

  lines.push("Next:");
  for (const item of result.next) {
    lines.push(`   ${item}`);
  }

  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: cleanup plan is safe to review."
    : "Result: review possible secrets first. Nothing was changed.");
  return lines.join("\n");
}

function section(lines, title, items, format) {
  lines.push(`${title}: ${items.length}`);
  for (const item of items.slice(0, 5)) {
    lines.push(`   ${format(item)}`);
  }
  lines.push("");
}
