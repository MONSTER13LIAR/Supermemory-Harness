import { homedir } from "node:os";
import { runDoctor } from "./doctor.js";
import { runGuard } from "./guard.js";
import { appendExplanation, explainHarnessResult } from "./local-brain.js";
import { memoryDoctor } from "./memory.js";
import { repairWatchdog } from "./repair.js";

export async function runStatus(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 25
  };

  const doctor = await runDoctor({
    baseUrl: context.baseUrl,
    cwd: context.cwd,
    env: context.env,
    home: context.home,
    fetch: context.fetch
  });

  const memory = doctor.exitCode === 0
    ? await memoryDoctor({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })
    : null;

  const guard = await runGuard({
    action: "inbox",
    home: context.home,
    fetch: context.fetch
  });
  const watchdog = doctor.exitCode === 0
    ? await repairWatchdog({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })
    : null;

  const sections = [
    doctor.exitCode === 0
      ? section("Supermemory Local", "ok", `${doctor.summary.ok} checks passed`)
      : section("Supermemory Local", "fail", `${doctor.summary.fail} failing check(s)`),
    memory && memory.exitCode === 0
      ? section("Memory Health", "ok", `${memory.documents.sampled} documents sampled`)
      : section("Memory Health", "warn", memory ? `${memory.summary.fail} fail, ${memory.summary.warn} warn` : "Skipped"),
    watchdog
      ? section("Repair Watchdog", watchdog.status === "ok" ? "ok" : "warn", watchdog.detail)
      : section("Repair Watchdog", "warn", "Skipped"),
    guard.pending.length === 0
      ? section("Guard Inbox", "ok", "0 pending writes")
      : section("Guard Inbox", "warn", `${guard.pending.length} pending write(s)`)
  ];

  const next = nextSteps({ doctor, memory, guard, watchdog });
  const summary = summarizeSections(sections);
  const result = {
    command: "status",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    sections,
    next,
    doctor: {
      exitCode: doctor.exitCode,
      summary: doctor.summary
    },
    memory: memory ? {
      exitCode: memory.exitCode,
      summary: memory.summary,
      sampled: memory.documents.sampled
    } : null,
    guard: {
      pending: guard.pending.length,
      summary: guard.summary
    },
    watchdog: watchdog ? {
      status: watchdog.status,
      detail: watchdog.detail
    } : null,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatStatus(result);
  if (options.explain) {
    result.explanation = await explainHarnessResult(result, {
      fetch: context.fetch,
      ollamaModel: options.ollamaModel
    });
    result.text = appendExplanation(result.text, result.explanation);
  }
  return result;
}

function nextSteps({ doctor, memory, guard, watchdog }) {
  if (doctor.exitCode !== 0) {
    return ["smctl doctor"];
  }

  const steps = [];
  if (watchdog && watchdog.status !== "ok") {
    steps.push("smctl repair");
  }
  if (memory && memory.exitCode !== 0) {
    steps.push("smctl memory doctor");
    steps.push("smctl memory replay");
  }
  if (guard.pending.length > 0) {
    steps.push("smctl guard inbox");
  }
  if (steps.length === 0) {
    steps.push("smctl smoke");
  }
  return steps;
}

function formatStatus(result) {
  const lines = [];
  lines.push("Supermemory Harness status");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");

  for (const item of result.sections) {
    lines.push(`${symbol(item.status)} ${item.title}`);
    lines.push(`   ${item.detail}`);
  }

  lines.push("");
  if (result.next.length > 0) {
    lines.push(`Recommended: ${result.next[0]}`);
    const detail = nextDetail(result.next[0]);
    if (detail) lines.push(`   ${detail}`);
  }

  const more = result.next.slice(1);
  if (more.length > 0) {
    lines.push("");
    lines.push("More detail:");
    for (const step of more) {
      lines.push(`   ${step}`);
    }
  }

  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: Harness status is usable."
    : "Result: Harness status needs attention.");
  return lines.join("\n");
}

function nextDetail(step) {
  const details = {
    "smctl doctor": "Supermemory itself needs attention first.",
    "smctl repair": "Shows what is broken and the safest repair plan without changing data.",
    "smctl guard inbox": "Review pending memory writes before they are saved.",
    "smctl smoke": "Runs a quick write/search test to prove recall works."
  };
  return details[step] ?? null;
}

function section(title, status, detail) {
  return { title, status, detail };
}

function summarizeSections(sections) {
  return sections.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
