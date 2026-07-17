import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readProjectProfile } from "./project.js";

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{16,}/,
  /\bsk-ant-[a-zA-Z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /BEGIN (RSA |OPENSSH |EC |)?PRIVATE KEY/,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]{8,}/i
];

export async function analyzeMemory(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 100
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const profile = await readProjectProfile(context.home);
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const documents = list.body?.memories ?? list.body?.documents ?? [];
  const processing = await getJson(context.fetch, `${context.baseUrl}/v3/documents/processing`);
  const logs = await inspectLogs(context.home);
  const storage = await inspectStorage(context.home);
  const containerTags = unique(documents.flatMap((doc) => doc.containerTags ?? []));
  const memorySamples = await sampleMemoryContainers(context, documents, containerTags);

  const failed = documents.filter((doc) => ["failed", "error"].includes(doc.status));
  const queued = documents.filter((doc) => ["queued", "processing"].includes(doc.status));
  const stale = queued.filter((doc) => isStale(doc));
  const done = documents.filter((doc) => doc.status === "done");
  const duplicates = findDuplicates(documents);
  const risky = documents.filter(hasSecretRisk).map(documentSummary);
  const testMarkers = documents.filter(isHarnessTestMarker).map(documentSummary);
  const vague = documents.filter(isVagueMemory).map(documentSummary);
  const contradictions = findContradictions(documents);
  const missingProject = findMissingProject(documents, profile).map(documentSummary);
  const missingAnchors = documents.filter(isMissingSourceAnchor).map(documentSummary);
  const zeroMemoryContainers = memorySamples.filter((sample) => sample.totalItems === 0);
  const timeline = buildTimeline(documents);
  const topContainers = countContainers(documents);
  const statusCounts = countBy(documents, (doc) => doc.status ?? "unknown");
  const issues = buildIssues({
    list,
    processing,
    documents,
    failed,
    queued,
    stale,
    duplicates,
    risky,
    vague,
    contradictions,
    missingProject,
    missingAnchors,
    zeroMemoryContainers,
    logs,
    storage,
    profile
  });
  const score = scoreMemory({ issues, documents, done });

  return {
    command: "insights",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    limit: context.limit,
    reachable: list.ok,
    list: {
      ok: list.ok,
      detail: responseDetail(list)
    },
    processing: {
      ok: processing.ok,
      status: processing.status,
      body: processing.body,
      detail: responseDetail(processing)
    },
    profile,
    documents: {
      sampled: documents.length,
      statusCounts,
      failed: failed.map(documentSummary),
      queued: queued.map(documentSummary),
      stale: stale.map(documentSummary),
      done: done.length
    },
    quality: {
      duplicates,
      risky,
      testMarkers,
      vague,
      contradictions,
      missingProject,
      missingAnchors,
      zeroMemoryContainers
    },
    memorySamples,
    timeline,
    topContainers,
    logs,
    storage,
    issues,
    score,
    next: nextSteps({ issues, score })
  };
}

export function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;
  const kib = bytes / 1024;
  if (kib >= 1) return `${kib.toFixed(1)} KiB`;
  return `${bytes} B`;
}

async function sampleMemoryContainers(context, documents, containerTags) {
  const samples = [];
  for (const tag of containerTags.slice(0, 8)) {
    const response = await postJson(context.fetch, `${context.baseUrl}/v4/memories/list`, {
      containerTags: [tag],
      limit: 5
    });
    if (!response.ok) continue;
    samples.push({
      containerTag: tag,
      documents: documents.filter((doc) => (doc.containerTags ?? []).includes(tag)).length,
      totalItems: response.body?.pagination?.totalItems ?? response.body?.memoryEntries?.length ?? 0
    });
  }
  return samples;
}

function buildIssues(input) {
  const issues = [];
  if (!input.list.ok) {
    issues.push(fail("Document inventory unavailable", responseDetail(input.list), "smctl doctor"));
    return issues;
  }
  if (!input.processing.ok && input.processing.status >= 500) {
    issues.push(fail("Supermemory processing API is failing", responseDetail(input.processing), "smctl doctor"));
  }
  if (input.failed.length > 0) {
    issues.push(fail("Failed memory writes", `${input.failed.length} of ${input.documents.length} sampled`, "smctl repair wizard"));
  }
  if (input.stale.length > 0) {
    issues.push(fail("Stuck queued writes", `${input.stale.length} queued for more than 30 minutes`, "smctl repair wizard"));
  } else if (input.queued.length > 0) {
    issues.push(warn("Writes still processing", `${input.queued.length} queued/processing`, "smctl status"));
  }
  if (input.logs.schemaMismatch.length > 0) {
    issues.push(fail("Supermemory Local schema mismatch", input.logs.schemaMismatch.at(-1), "smctl doctor"));
  } else if (input.logs.retryLoop.length > 0) {
    issues.push(fail("Retry loop in Supermemory logs", input.logs.retryLoop.at(-1), "smctl repair wizard"));
  } else if (input.logs.failures.length > 0) {
    issues.push(warn("Recent failure hints in logs", input.logs.failures.at(-1), "smctl repair"));
  }
  if (input.zeroMemoryContainers.length > 0 && input.documents.some((doc) => doc.status === "done")) {
    issues.push(warn("Documents exist but memory recall looks empty", input.zeroMemoryContainers.map((item) => item.containerTag).join(", "), "smctl verify"));
  }
  if (input.duplicates.length > 0) {
    issues.push(warn("Duplicate-looking memories", `${input.duplicates.length} group(s)`, "smctl cleanup"));
  }
  if (input.risky.length > 0) {
    issues.push(fail("Possible secrets in memory writes", `${input.risky.length} risky item(s)`, "smctl cleanup"));
  }
  if (input.vague.length > 0) {
    issues.push(warn("Vague memories need better wording", `${input.vague.length} item(s)`, "smctl memory coach"));
  }
  if (input.contradictions.length > 0) {
    issues.push(warn("Contradictory project memories", `${input.contradictions.length} conflict group(s)`, "smctl memory coach"));
  }
  if (input.profile && input.missingProject.length > 0) {
    issues.push(warn("Memories missing project context", `${input.missingProject.length} item(s) not tagged as ${input.profile.containerTag}`, "smctl start"));
  }
  if (input.missingAnchors.length > 0) {
    issues.push(warn("Memories missing source anchors", `${input.missingAnchors.length} item(s) have no URL, filepath, source, or migration local ID`, "smctl memory coach"));
  }
  if (!input.profile) {
    issues.push(warn("No active project profile", "Run from the project folder to separate app memories", "smctl init"));
  }
  if (input.storage.risk === "fail") {
    issues.push(fail("Local store near snapshot risk zone", `${formatBytes(input.storage.bytes)} at ${input.storage.path}`, "smctl repair"));
  } else if (input.storage.risk === "warn") {
    issues.push(warn("Local store is growing", `${formatBytes(input.storage.bytes)} at ${input.storage.path}`, "smctl repair"));
  }
  if (issues.length === 0) {
    issues.push(ok("Memory system looks healthy", `${input.documents.length} documents sampled`, "smctl verify"));
  }
  return issues;
}

function scoreMemory({ issues, documents, done }) {
  if (documents.length === 0) {
    return {
      value: 55,
      label: "Needs data",
      detail: "No documents were sampled, so Harness cannot prove recall quality yet."
    };
  }

  let value = 100;
  for (const issue of issues) {
    if (issue.status === "fail") value -= issue.title.includes("secrets") ? 25 : 18;
    if (issue.status === "warn") value -= 8;
  }
  if (done === 0) value -= 15;
  value = Math.max(0, Math.min(100, value));
  return {
    value,
    label: value >= 85 ? "Strong" : value >= 65 ? "Usable" : value >= 40 ? "Needs attention" : "Broken",
    detail: value >= 85
      ? "Memory writes, context, and recall signals look good in the sample."
      : "Harness found issues that can reduce recall quality or make Supermemory feel unreliable."
  };
}

function nextSteps({ issues, score }) {
  const commands = [];
  for (const issue of issues) {
    if (issue.command && !commands.includes(issue.command)) commands.push(issue.command);
  }
  if (score.value < 70 && !commands.includes("smctl verify")) commands.push("smctl verify");
  return commands.slice(0, 4);
}

function findDuplicates(documents) {
  const groups = new Map();
  for (const doc of documents) {
    const key = normalizeDuplicateKey(doc);
    if (!key) continue;
    const items = groups.get(key) ?? [];
    items.push(documentSummary(doc));
    groups.set(key, items);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, count: items.length, items }))
    .sort((a, b) => b.count - a.count);
}

function findContradictions(documents) {
  const facts = new Map();
  for (const doc of documents) {
    if (doc.status && doc.status !== "done") continue;
    const extracted = extractFacts(doc);
    for (const fact of extracted) {
      const items = facts.get(fact.subject) ?? new Map();
      const valueItems = items.get(fact.value) ?? [];
      valueItems.push(documentSummary(doc));
      items.set(fact.value, valueItems);
      facts.set(fact.subject, items);
    }
  }

  return [...facts.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([subject, values]) => ({
      subject,
      values: [...values.entries()].map(([value, items]) => ({ value, count: items.length, items: items.slice(0, 3) }))
    }))
    .slice(0, 8);
}

function extractFacts(doc) {
  const text = `${doc.title ?? ""}. ${doc.content ?? doc.raw ?? ""}`;
  const facts = [];
  const patterns = [
    /\b(test runner|package manager|database|runtime|framework|auth provider|deployment target)\s+(?:is|=|:)\s+([A-Za-z0-9._-]+)/gi,
    /\b(?:use|uses|prefer|prefers|standardize on|choose|chosen)\s+([A-Za-z0-9._-]+)\s+(?:for|as)\s+(test runner|package manager|database|runtime|framework|auth provider|deployment target)\b/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const first = normalizeFact(match[1]);
      const second = normalizeFact(match[2]);
      const subject = isFactSubject(first) ? first : second;
      const value = isFactSubject(first) ? second : first;
      if (subject && value && !isVagueFactValue(value)) {
        facts.push({ subject, value });
      }
    }
  }
  return facts;
}

function normalizeFact(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isFactSubject(value) {
  return /^(test runner|package manager|database|runtime|framework|auth provider|deployment target)$/.test(value);
}

function isVagueFactValue(value) {
  return /^(the|a|an|this|that|for|as)$/.test(value);
}

function findMissingProject(documents, profile) {
  if (!profile?.containerTag) return [];
  return documents.filter((doc) => {
    const tags = doc.containerTags ?? [];
    const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
    return doc.status === "done" && !tags.includes(profile.containerTag) && metadata.smctlProject !== profile.name;
  });
}

function hasSecretRisk(doc) {
  const text = `${doc.title ?? ""}\n${doc.content ?? ""}\n${doc.raw ?? ""}`;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function isHarnessTestMarker(doc) {
  const text = `${doc.title ?? ""}\n${doc.content ?? ""}\n${doc.customId ?? ""}`;
  return /smctl|Supermemory Harness smoke|language recall probe|verify marker|UX live test/i.test(text);
}

function isVagueMemory(doc) {
  const title = String(doc.title ?? "").trim();
  const content = String(doc.content ?? doc.raw ?? "").trim();
  const text = `${title} ${content}`.trim();
  if (!text) return true;
  if (text.length < 30) return true;
  return /^(remember this|note|todo|important|save this)$/i.test(title);
}

function isMissingSourceAnchor(doc) {
  if (doc.status && doc.status !== "done") return false;
  const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
  return !(
    doc.url
    || doc.filepath
    || (doc.source && doc.source !== "supermemory-local")
    || metadata.url
    || metadata.filepath
    || metadata.source
    || metadata.smctlLocalId
  );
}

function normalizeDuplicateKey(doc) {
  const title = String(doc.title ?? doc.customId ?? "").trim().toLowerCase();
  const content = String(doc.content ?? doc.raw ?? "").trim().toLowerCase();
  const source = title || content.slice(0, 120);
  return source
    .replace(/\s+/g, " ")
    .replace(/[^\w\s:-]/g, "")
    .slice(0, 120);
}

function buildTimeline(documents) {
  const days = new Map();
  for (const doc of documents) {
    const raw = doc.updatedAt ?? doc.createdAt;
    const day = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString().slice(0, 10) : "unknown";
    const item = days.get(day) ?? { day, total: 0, failed: 0, queued: 0, done: 0 };
    item.total += 1;
    if (["failed", "error"].includes(doc.status)) item.failed += 1;
    else if (["queued", "processing"].includes(doc.status)) item.queued += 1;
    else if (doc.status === "done") item.done += 1;
    days.set(day, item);
  }
  return [...days.values()].sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

function countContainers(documents) {
  const counts = new Map();
  for (const doc of documents) {
    for (const tag of doc.containerTags ?? ["untagged"]) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([containerTag, count]) => ({ containerTag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

async function inspectLogs(home) {
  try {
    const content = await readFile(join(home, ".supermemory", "server.log"), "utf8");
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      failures: lines.filter((line) => /failed|error|oom|out of memory|RangeError/i.test(line)).slice(-10),
      retryLoop: lines.filter((line) => /Permanently failed|no retry params|missed execution|retry/i.test(line)).slice(-10),
      schemaMismatch: lines.filter(isSchemaMismatchLine).slice(-10)
    };
  } catch {
    return { failures: [], retryLoop: [], schemaMismatch: [] };
  }
}

function isSchemaMismatchLine(line) {
  return /column "(dreaming_status|profile_buckets)" does not exist/.test(line)
    || (/Failed query:/.test(line) && /"(dreaming_status|profile_buckets)"/.test(line));
}

async function inspectStorage(home) {
  const candidates = [
    join(home, ".supermemory", "data", "data"),
    join(home, ".supermemory", "data")
  ];
  for (const path of candidates) {
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      return {
        path: redactHome(path, home),
        bytes: info.size,
        risk: info.size >= 150 * 1024 * 1024 ? "fail" : info.size >= 120 * 1024 * 1024 ? "warn" : "ok"
      };
    } catch {
      // Try the next known local store path.
    }
  }
  return { path: "~/.supermemory/data", bytes: 0, risk: "warn", missing: true };
}

function isStale(doc) {
  const value = doc.updatedAt ?? doc.createdAt;
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > 30 * 60 * 1000;
}

function documentSummary(doc) {
  return {
    id: doc.id,
    status: doc.status,
    title: doc.title ?? doc.customId ?? "(untitled)",
    containerTags: doc.containerTags ?? []
  };
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function ok(title, detail, command) {
  return { status: "ok", title, detail, command };
}

function warn(title, detail, command) {
  return { status: "warn", title, detail, command };
}

function fail(title, detail, command) {
  return { status: "fail", title, detail, command };
}

async function postJson(fetchFn, url, body) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function getJson(fetchFn, url) {
  return requestJson(fetchFn, url, { method: "GET" });
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
    return {
      ok: false,
      status: null,
      body: null,
      text: "",
      error: formatFetchError(error)
    };
  }
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status && !response.ok) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  if (response.status) return `HTTP ${response.status}`;
  return "No response";
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) return `${error.message}: ${cause.code}`;
  return error.message;
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
