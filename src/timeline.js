import { analyzeMemory } from "./insights.js";

export async function runTimeline(options = {}) {
  const analysis = await analyzeMemory(options);
  const result = {
    command: "timeline",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    timeline: analysis.timeline.slice(0, 14),
    topContainers: analysis.topContainers,
    sampled: analysis.documents.sampled,
    exitCode: analysis.reachable ? 0 : 1
  };
  result.text = formatTimeline(result);
  return result;
}

function formatTimeline(result) {
  const lines = [];
  lines.push("Supermemory Harness timeline");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Sample: ${result.sampled} documents`);
  lines.push("");

  if (result.timeline.length === 0) {
    lines.push("No memory write activity found in the sample.");
  } else {
    lines.push("Recent write activity:");
    for (const day of result.timeline) {
      lines.push(`   ${day.day}  total:${day.total}  done:${day.done}  queued:${day.queued}  failed:${day.failed}`);
    }
  }

  if (result.topContainers.length > 0) {
    lines.push("");
    lines.push("Top containers:");
    for (const item of result.topContainers) {
      lines.push(`   ${item.containerTag}  ${item.count}`);
    }
  }

  lines.push("");
  lines.push("Result: timeline review complete.");
  return lines.join("\n");
}
