import { homedir } from "node:os";
import { analyzeMemory } from "./insights.js";
import { memoryDoctor } from "./memory.js";
import { readProjectProfile } from "./project.js";
import { runRepair } from "./repair.js";
import { runVerify } from "./verify.js";

export async function runTrust(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 50,
    probe: Boolean(options.probe),
    timeoutMs: options.timeoutMs ?? 20000,
    sleep: options.sleep
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const profile = await readProjectProfile(context.home);
  const [analysis, memory, repair, profileHealth, localHealth] = await Promise.all([
    safeResult(() => analyzeMemory({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    safeResult(() => memoryDoctor({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    safeResult(() => runRepair({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    })),
    checkProfileHealth(context, profile),
    checkLocalHealth(context)
  ]);

  const checks = [];
  checks.push(localHealth.ok
    ? ok("Supermemory Local reachable", localHealth.detail)
    : fail("Supermemory Local unreachable", localHealth.detail));

  checks.push(profile
    ? ok("Active project scope", `${profile.name} -> ${profile.containerTag}`)
    : warn("No active project scope", "Run smctl init from the code project before trusting coding-agent memory."));

  checks.push(profileHealth.status === "ok"
    ? ok("Profile API healthy", profileHealth.detail)
    : profileHealth.status === "warn"
      ? warn("Profile API uncertain", profileHealth.detail)
      : fail("Profile API broken", profileHealth.detail));

  checks.push(...scopeChecks({ analysis, profile }));
  checks.push(...pipelineChecks({ analysis, memory, repair }));
  checks.push(...qualityChecks({ analysis }));
  checks.push(...resilienceChecks({ analysis }));

  let probe = null;
  if (context.probe && localHealth.ok) {
    probe = await safeResult(() => runVerify({
      baseUrl: context.baseUrl,
      home: context.home,
      cwd: context.cwd,
      fetch: context.fetch,
      timeoutMs: context.timeoutMs,
      sleep: context.sleep
    }));
    checks.push(probe.exitCode === 0
      ? ok("Live write/read probe", `Verified ${probe.containerTag}`)
      : fail("Live write/read probe", probe.text ?? probe.error ?? "Probe failed"));
  } else if (!context.probe) {
    checks.push(warn("Live write/read probe not run", "Run smctl trust --probe to write a harmless marker and prove ingest, processing, search, and container recall."));
  }

  const score = scoreTrust(checks, analysis);
  const summary = summarize(checks);
  const result = {
    command: "trust",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    mode: context.probe ? "probe" : "read-only",
    profile,
    score,
    checks,
    summary,
    analysis,
    memory,
    repair,
    profileHealth,
    probe,
    next: nextSteps(checks, score),
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatTrust(result);
  return result;
}

function scopeChecks({ analysis, profile }) {
  const checks = [];
  if (analysis.error) {
    checks.push(fail("Memory inventory unavailable", analysis.error));
    return checks;
  }
  const quality = analysis.quality ?? {};
  const topContainers = analysis.topContainers ?? [];
  const memorySamples = analysis.memorySamples ?? [];

  if (!profile) return checks;

  const missingProject = quality.missingProject ?? [];
  if (missingProject.length > 0) {
    checks.push(warn("Project scope drift detected", `${missingProject.length} sampled write(s) are not tagged as ${profile.containerTag}`));
  } else {
    checks.push(ok("Sampled writes respect project scope", profile.containerTag));
  }

  const otherContainers = topContainers.filter((item) => item.containerTag && item.containerTag !== profile.containerTag);
  if (otherContainers.length > 0) {
    checks.push(warn("Other project containers visible in recent sample", otherContainers.slice(0, 4).map((item) => `${item.containerTag}:${item.count}`).join(", ")));
  } else {
    checks.push(ok("No cross-project containers in recent sample", `${topContainers.length} container(s) sampled`));
  }

  const emptyProject = memorySamples.find((sample) => sample.containerTag === profile.containerTag && sample.totalItems === 0 && sample.documents > 0);
  if (emptyProject) {
    checks.push(fail("Project has documents but no listed memories", profile.containerTag));
  }

  return checks;
}

function pipelineChecks({ analysis, memory, repair }) {
  const checks = [];
  const docs = analysis.documents ?? {};
  if (docs.failed?.length > 0) {
    checks.push(fail("Failed memory writes", `${docs.failed.length} failed in recent sample`));
  } else if (!analysis.error) {
    checks.push(ok("No failed writes in recent sample", `${docs.sampled ?? 0} sampled`));
  }

  if (docs.stale?.length > 0) {
    checks.push(fail("Stuck queued writes", `${docs.stale.length} stale queued item(s)`));
  } else if (docs.queued?.length > 0) {
    checks.push(warn("Writes still processing", `${docs.queued.length} queued/processing`));
  } else if (!analysis.error) {
    checks.push(ok("No stuck processing backlog", `${docs.sampled ?? 0} sampled`));
  }

  const zeroContainers = analysis.quality?.zeroMemoryContainers ?? [];
  if (zeroContainers.length > 0) {
    checks.push(warn("Documents exist but memory recall looks empty", zeroContainers.map((item) => item.containerTag).join(", ")));
  }

  if (memory.error) {
    checks.push(warn("Memory doctor unavailable", memory.error));
  }
  if (repair.summary?.fail > 0) {
    checks.push(fail("Repair doctor found blocking issues", `${repair.summary.fail} fail, ${repair.summary.warn} warn`));
  } else if (repair.summary) {
    checks.push(ok("Repair doctor found no blocking issue", `${repair.summary.warn} warning(s)`));
  }
  return checks;
}

function qualityChecks({ analysis }) {
  const checks = [];
  const quality = analysis.quality ?? {};
  if ((quality.risky ?? []).length > 0) {
    checks.push(fail("Possible secrets stored in memory", `${quality.risky.length} risky item(s)`));
  }
  if ((quality.duplicates ?? []).length > 0) {
    checks.push(warn("Duplicate-looking memories", `${quality.duplicates.length} group(s)`));
  }
  if ((quality.vague ?? []).length > 0) {
    checks.push(warn("Vague memories reduce recall quality", `${quality.vague.length} item(s)`));
  }
  if (!analysis.error && checks.length === 0) {
    checks.push(ok("No obvious memory quality risks", `${analysis.documents?.sampled ?? 0} sampled`));
  }
  return checks;
}

function resilienceChecks({ analysis }) {
  const checks = [];
  const logs = analysis.logs ?? {};
  const storage = analysis.storage ?? {};
  if ((logs.retryLoop ?? []).length > 0) {
    checks.push(fail("Retry loop hints in local logs", logs.retryLoop.at(-1)));
  } else if ((logs.failures ?? []).length > 0) {
    checks.push(warn("Recent failure hints in local logs", logs.failures.at(-1)));
  } else if (!analysis.error) {
    checks.push(ok("No recent local retry-loop hints", "~/.supermemory/server.log"));
  }
  if (storage.risk === "fail") {
    checks.push(fail("Local store near snapshot risk zone", `${formatBytes(storage.bytes)} at ${storage.path}`));
  } else if (storage.risk === "warn") {
    checks.push(warn("Local store is growing", `${formatBytes(storage.bytes)} at ${storage.path}`));
  } else if (storage.path) {
    checks.push(ok("Local store size looks safe", `${formatBytes(storage.bytes)} at ${storage.path}`));
  }
  return checks;
}

async function checkProfileHealth(context, profile) {
  const body = profile?.containerTag ? { containerTag: profile.containerTag } : {};
  const response = await postJson(context.fetch, `${context.baseUrl}/v4/profile`, body);
  if (response.ok) {
    return { status: "ok", detail: "POST /v4/profile returned 2xx" };
  }
  if (response.status === 404) {
    return { status: "warn", detail: "POST /v4/profile not available on this local server" };
  }
  return { status: "fail", detail: responseDetail(response) };
}

async function checkLocalHealth(context) {
  const dashboard = await getText(context.fetch, context.baseUrl);
  const openapi = await getText(context.fetch, `${context.baseUrl}/v4/openapi`);
  const ok = dashboard.ok && openapi.ok;
  return {
    ok,
    detail: `Dashboard: ${dashboard.status ?? "no response"}, OpenAPI: ${openapi.status ?? "no response"}`
  };
}

function scoreTrust(checks, analysis) {
  let value = analysis.score?.value ?? 80;
  for (const check of checks) {
    if (check.status === "fail") value -= 14;
    if (check.status === "warn") value -= 5;
  }
  value = Math.max(0, Math.min(100, value));
  return {
    value,
    label: value >= 85 ? "Trustworthy" : value >= 65 ? "Usable" : value >= 40 ? "Risky" : "Do not trust",
    detail: value >= 85
      ? "Supermemory looks safe to trust for coding-agent memory."
      : "Harness found risks that can make memory incomplete, cross-scoped, stale, or unavailable."
  };
}

function nextSteps(checks, score) {
  const steps = [];
  if (checks.some((check) => check.title.includes("Local unreachable"))) steps.push("Start Supermemory Local: supermemory-server");
  if (checks.some((check) => check.status !== "ok" && (check.title.includes("project scope") || check.title.includes("Project scope")))) steps.push("smctl init");
  if (checks.some((check) => check.title.includes("Profile API") || check.title.includes("Repair doctor") || check.title.includes("Failed memory") || check.title.includes("Stuck queued"))) steps.push("smctl repair wizard");
  if (checks.some((check) => check.title.includes("probe not run"))) steps.push("smctl trust --probe");
  if (score.value < 70) steps.push("smctl verify");
  return [...new Set(steps)].slice(0, 5);
}

function formatTrust(result) {
  const lines = [];
  lines.push("Supermemory Harness Trust Doctor");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Trust: ${result.score.value}/100 (${result.score.label})`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${trimDetail(check.detail)}`);
  }
  if (result.next.length > 0) {
    lines.push("");
    lines.push("Next:");
    for (const step of result.next) lines.push(`   ${step}`);
  }
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: Supermemory is usable, with warnings noted above if any."
    : "Result: do not rely on Supermemory until the failing trust checks are fixed.");
  return lines.join("\n");
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
}

async function safeResult(fn) {
  try {
    return await fn();
  } catch (error) {
    return { error: error.message, exitCode: 1 };
  }
}

async function postJson(fetchFn, url, body) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function requestJson(fetchFn, url, init) {
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null,
      text
    };
  } catch (error) {
    return { ok: false, status: null, body: null, text: "", error: formatFetchError(error) };
  }
}

async function getText(fetchFn, url) {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, status: null, text: "", error: formatFetchError(error) };
  }
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function warn(title, detail) {
  return { status: "warn", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

function trimDetail(value) {
  const text = String(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function formatFetchError(error) {
  if (error?.name === "TimeoutError") return "Request timed out";
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;
  const kib = bytes / 1024;
  if (kib >= 1) return `${kib.toFixed(1)} KiB`;
  return `${bytes} B`;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
