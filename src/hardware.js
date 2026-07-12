import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_OLLAMA_MODEL = "llama3.2:1b-instruct-q4_K_M";

export async function runHardware(options = {}) {
  const action = options.action ?? "coach";
  if (action === "init") return hardwareInit(options);
  if (action === "ingest") return hardwareIngest(options);
  if (action === "observe") return hardwareObserve(options);
  if (action === "coach") return hardwareCoach(options);
  if (action === "replay") return hardwareReplay(options);
  throw new Error(`Unknown hardware action: ${action}`);
}

export async function hardwareInit(options = {}) {
  const context = hardwareContext(options);
  const name = options.name ?? options.device ?? "hardware-device";
  const profile = {
    version: 1,
    name,
    device: options.device ?? slugify(name),
    adapter: options.adapter ?? "logs",
    project: options.project ?? null,
    hardwareTag: `hardware:${slugify(options.device ?? name)}`,
    projectTag: options.project ? `project:${slugify(options.project)}` : null,
    createdAt: new Date().toISOString()
  };

  await mkdir(dirname(context.profilePath), { recursive: true });
  await writeFile(context.profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });

  const result = {
    command: "hardware init",
    generatedAt: new Date().toISOString(),
    profile,
    path: redactHome(context.profilePath, context.home),
    exitCode: 0
  };
  result.text = formatInit(result);
  return result;
}

export async function hardwareIngest(options = {}) {
  const context = hardwareContext(options);
  const profile = await readHardwareProfile(context.home);
  const from = options.from;
  if (!from) throw new Error("hardware ingest requires --from <log-file>");

  const raw = await readFile(from, "utf8");
  return ingestHardwareText({
    ...options,
    raw,
    source: from,
    profile,
    context
  });
}

export async function hardwareObserve(options = {}) {
  const context = hardwareContext(options);
  const profile = await readHardwareProfile(context.home);

  if (options.serial) {
    return unsupportedObserve("serial", "Pipe a serial monitor into stdin for now: arduino-cli monitor -p <port> | smctl hardware observe --stdin");
  }
  if (options.mqtt) {
    return unsupportedObserve("mqtt", "Pipe an MQTT subscriber into stdin for now: mosquitto_sub ... | smctl hardware observe --stdin");
  }

  const raw = options.stdinText ?? await readStdin(options.stdin);
  if (!raw.trim()) {
    return {
      command: "hardware observe",
      exitCode: 1,
      text: [
        "Supermemory Harness hardware observe",
        "[fail] No stdin log data received",
        "   Pipe a monitor/log command into Harness, for example:",
        "   arduino-cli monitor -p <port> | smctl hardware observe --stdin --device <id>",
        "",
        "Result: no hardware experience captured."
      ].join("\n")
    };
  }
  return ingestHardwareText({
    ...options,
    raw,
    source: "stdin",
    profile,
    context,
    observe: true
  });
}

export async function hardwareCoach(options = {}) {
  const context = hardwareContext(options);
  const profile = await readHardwareProfile(context.home);
  const tag = hardwareTag(options, profile);

  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: options.limit ?? 50,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const documents = list.body?.memories ?? list.body?.documents ?? [];
  const hardwareDocs = documents.filter((doc) => (doc.containerTags ?? []).includes(tag));
  const failed = hardwareDocs.filter((doc) => ["failed", "error"].includes(doc.status));
  const done = hardwareDocs.filter((doc) => doc.status === "done");
  const sessions = unique(hardwareDocs.flatMap((doc) => doc.containerTags ?? []).filter((item) => item.startsWith("session:")));

  const checks = [];
  if (!profile) checks.push(warn("No hardware profile", "Run smctl hardware init --name <device-name>"));
  else checks.push(ok("Hardware profile", `${profile.name} (${profile.hardwareTag})`));
  if (!list.ok) checks.push(fail("Document inventory unavailable", responseDetail(list)));
  else checks.push(ok("Hardware memory sample", `${hardwareDocs.length} matching documents from ${documents.length} sampled`));
  if (failed.length > 0) checks.push(fail("Failed hardware memories", `${failed.length} failed writes`));
  else checks.push(ok("No failed hardware memories in sample", `${hardwareDocs.length} sampled`));
  if (sessions.length > 0) checks.push(ok("Sessions found", sessions.slice(0, 5).join(", ")));
  else checks.push(warn("No session tags found", "Use --session when ingesting test runs"));

  const summary = summarize(checks);
  const result = {
    command: "hardware coach",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    profile,
    hardwareTag: tag,
    documents: {
      sampled: documents.length,
      hardware: hardwareDocs.length,
      done: done.length,
      failed: failed.length
    },
    sessions,
    checks,
    next: hardwareNext({ profile, hardwareDocs, failed, sessions }),
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatCoach(result);
  return result;
}

export async function hardwareReplay(options = {}) {
  const context = hardwareContext(options);
  const profile = await readHardwareProfile(context.home);
  const tag = hardwareTag(options, profile);
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: options.limit ?? 50,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const documents = list.body?.memories ?? list.body?.documents ?? [];
  const hardwareDocs = documents.filter((doc) => (doc.containerTags ?? []).includes(tag));
  const recent = hardwareDocs.slice(0, 8).map((doc) => ({
    id: doc.id,
    status: doc.status,
    title: doc.title ?? doc.customId ?? "(untitled)",
    tags: doc.containerTags ?? []
  }));

  const result = {
    command: "hardware replay",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    hardwareTag: tag,
    recent,
    exitCode: list.ok ? 0 : 1
  };
  result.text = formatReplay(result);
  return result;
}

export async function readHardwareProfile(home = homedir()) {
  const path = hardwareProfilePath(home);
  if (!await exists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function ingestHardwareText(input) {
  const context = input.context ?? hardwareContext(input);
  const profile = input.profile ?? await readHardwareProfile(context.home);
  const events = parseHardwareEvents(input.raw);
  const summary = await summarizeHardwareEvents(events, {
    fetch: context.fetch,
    ollamaModel: input.ollamaModel ?? DEFAULT_OLLAMA_MODEL,
    useBrain: input.brain !== false
  });
  const tags = buildTags(input, profile);
  const content = buildMemoryContent({ summary, events, tags, source: input.source });
  const dryRun = Boolean(input.dryRun);
  let write = null;

  if (!dryRun) {
    write = await postJson(context.fetch, `${context.baseUrl}/v3/documents`, {
      content,
      containerTag: tags.hardwareTag,
      containerTags: tags.all,
      customId: `smctl-hardware-${tags.device}-${Date.now()}`,
      metadata: {
        source: "smctl-hardware",
        adapter: input.observe ? "observe" : "ingest",
        device: tags.device,
        session: tags.session,
        eventCount: events.length,
        sourcePath: input.source
      }
    });
  }

  const result = {
    command: input.observe ? "hardware observe" : "hardware ingest",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    mode: dryRun ? "dry-run" : "write",
    source: input.source,
    tags,
    events: events.slice(0, 12),
    eventCount: events.length,
    summary,
    write: write ? {
      ok: write.ok,
      status: write.status,
      id: write.body?.id,
      detail: responseDetail(write)
    } : null,
    exitCode: write && !write.ok ? 1 : 0
  };
  result.text = formatIngest(result);
  return result;
}

function parseHardwareEvents(raw) {
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((line) => {
      const severity = /fail|error|fault|overheat|stall|timeout|jam/i.test(line)
        ? "problem"
        : /ok|success|done|calibrated|ready/i.test(line)
          ? "success"
          : /warn|drift|retry|slow|noise/i.test(line)
            ? "warning"
            : "event";
      return { severity, line };
    });
}

async function summarizeHardwareEvents(events, options) {
  const fallback = heuristicSummary(events);
  if (!options.useBrain || !options.fetch || events.length === 0) return fallback;

  const response = await postJson(options.fetch, "http://localhost:11434/api/generate", {
    model: options.ollamaModel,
    stream: false,
    prompt: [
      "Summarize hardware logs into one useful long-term memory.",
      "Return exactly 4 short lines:",
      "Behavior: ...",
      "Problems: ...",
      "Fixes or next test: ...",
      "Remember: ...",
      "Do not invent facts. Do not include secrets.",
      events.slice(0, 80).map((event) => event.line).join("\n")
    ].join("\n"),
    options: {
      temperature: 0.1,
      num_predict: 100,
      num_ctx: 1024
    }
  }, 15000);

  const text = sanitizeSummary(response.body?.response);
  if (!response.ok || !text || !/Behavior:/i.test(text) || !/Remember:/i.test(text)) {
    return fallback;
  }
  return {
    provider: "ollama",
    text
  };
}

function heuristicSummary(events) {
  const problems = events.filter((event) => event.severity === "problem").slice(0, 5).map((event) => event.line);
  const warnings = events.filter((event) => event.severity === "warning").slice(0, 5).map((event) => event.line);
  const successes = events.filter((event) => event.severity === "success").slice(0, 5).map((event) => event.line);
  const notable = [...problems, ...warnings, ...successes].slice(0, 6);
  return {
    provider: "heuristic",
    text: [
      `Behavior: ${successes[0] ?? "hardware emitted event logs"}`,
      `Problems: ${problems.length > 0 ? problems.join("; ") : "no clear failure line detected"}`,
      `Fixes or next test: ${warnings[0] ?? "review the next run against this baseline"}`,
      `Remember: ${notable.length > 0 ? notable.join(" | ") : `${events.length} hardware event(s) captured`}`
    ].join("\n")
  };
}

function buildTags(input, profile) {
  const device = slugify(input.device ?? profile?.device ?? profile?.name ?? "hardware-device");
  const session = slugify(input.session ?? new Date().toISOString().slice(0, 10));
  const hardwareTag = profile?.hardwareTag ?? `hardware:${device}`;
  const projectTag = input.project ? `project:${slugify(input.project)}` : profile?.projectTag ?? null;
  const sessionTag = `session:${session}`;
  return {
    device,
    session,
    hardwareTag,
    projectTag,
    sessionTag,
    all: [hardwareTag, sessionTag, projectTag].filter(Boolean)
  };
}

function buildMemoryContent({ summary, events, tags, source }) {
  return [
    `Hardware memory for ${tags.hardwareTag}`,
    `Session: ${tags.sessionTag}`,
    `Source: ${source}`,
    "",
    summary.text,
    "",
    "Raw event sample:",
    ...events.slice(0, 20).map((event) => `- [${event.severity}] ${redactLine(event.line)}`)
  ].join("\n");
}

function formatInit(result) {
  return [
    "Supermemory Harness hardware init",
    `Device: ${result.profile.name}`,
    `Hardware tag: ${result.profile.hardwareTag}`,
    result.profile.projectTag ? `Project tag: ${result.profile.projectTag}` : "Project tag: none",
    `Profile: ${result.path}`,
    "",
    "Next:",
    "   smctl hardware ingest --from <log-file>",
    "   <serial monitor command> | smctl hardware observe --stdin"
  ].join("\n");
}

function formatIngest(result) {
  const lines = [];
  lines.push(`Supermemory Harness ${result.command}`);
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Source: ${result.source}`);
  lines.push(`Events: ${result.eventCount}`);
  lines.push(`Tags: ${result.tags.all.join(", ")}`);
  lines.push(`Summary provider: ${result.summary.provider}`);
  lines.push("");
  for (const line of result.summary.text.split(/\r?\n/)) {
    lines.push(`   ${line}`);
  }
  if (result.write) {
    lines.push("");
    lines.push(result.write.ok ? `[ok] Written to Supermemory` : `[fail] Supermemory write failed`);
    lines.push(`   ${result.write.ok ? result.write.id : result.write.detail}`);
  } else {
    lines.push("");
    lines.push("[dry-run] No Supermemory write was made.");
  }
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: hardware experience captured."
    : "Result: hardware capture needs attention.");
  return lines.join("\n");
}

function formatCoach(result) {
  const lines = [];
  lines.push("Supermemory Harness hardware coach");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Hardware tag: ${result.hardwareTag}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  lines.push("");
  lines.push("Next:");
  for (const step of result.next) lines.push(`   ${step}`);
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: hardware memory profile is usable."
    : "Result: hardware memory needs attention.");
  return lines.join("\n");
}

function formatReplay(result) {
  const lines = [];
  lines.push("Supermemory Harness hardware replay");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Hardware tag: ${result.hardwareTag}`);
  lines.push("");
  if (result.recent.length === 0) {
    lines.push("No recent hardware memories found in the sample.");
  } else {
    lines.push("Recent hardware memories:");
    for (const item of result.recent) {
      lines.push(`   ${item.status}  ${item.id}  ${item.title}`);
    }
  }
  lines.push("");
  lines.push("Result: hardware replay summary ready.");
  return lines.join("\n");
}

function hardwareNext({ profile, hardwareDocs, failed, sessions }) {
  if (!profile) return ["smctl hardware init --name <device-name>"];
  if (failed.length > 0) return ["smctl repair wizard"];
  if (hardwareDocs.length === 0) return ["smctl hardware ingest --from <log-file>"];
  if (sessions.length === 0) return ["smctl hardware ingest --from <log-file> --session <run-name>"];
  return ["smctl hardware replay"];
}

function unsupportedObserve(kind, detail) {
  const result = {
    command: "hardware observe",
    kind,
    exitCode: 1,
    text: [
      "Supermemory Harness hardware observe",
      `[warn] Direct ${kind} adapter is not bundled yet`,
      `   ${detail}`,
      "",
      "Result: use stdin bridge for this version."
    ].join("\n")
  };
  return result;
}

function hardwareContext(options) {
  const home = options.home ?? homedir();
  return {
    home,
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    fetch: options.fetch ?? globalThis.fetch,
    profilePath: hardwareProfilePath(home)
  };
}

function hardwareProfilePath(home) {
  return join(home, ".config", "smctl", "hardware", "active.json");
}

function hardwareTag(options, profile) {
  return profile?.hardwareTag ?? `hardware:${slugify(options.device ?? options.name ?? "hardware-device")}`;
}

async function readStdin(stdin) {
  if (!stdin?.readable) return "";
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk).toString("utf8"));
  }
  return chunks.join("");
}

async function postJson(fetchFn, url, body, timeoutMs = 5000) {
  if (!fetchFn) {
    return { ok: false, status: null, body: null, error: "Fetch API unavailable; Node 22+ is required" };
  }
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      text: "",
      error: formatFetchError(error)
    };
  }
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0 });
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function sanitizeSummary(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("\n");
}

function redactLine(line) {
  return line
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "[redacted-key]")
    .replace(/\b(password|token|secret)\s*[:=]\s*[^,\s]+/gi, "$1=[redacted]");
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "hardware-device";
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) return `${error.message}: ${cause.code}`;
  return error.message;
}
