import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { analyzeMemory, normalizeBaseUrl, symbol } from "./insights.js";
import { readProjectProfile } from "./project.js";
import { attachSmartSections } from "./smart-sections.js";

const CATEGORY_DEFINITIONS = [
  {
    id: "preferences",
    title: "Preferences",
    detail: "User likes, style choices, and operating preferences.",
    patterns: [/\bprefer(?:s|red|ence)?\b/i, /\blikes?\b/i, /\bwants?\b/i, /\bfavorite\b/i, /\bstyle\b/i, /\btone\b/i]
  },
  {
    id: "project_decisions",
    title: "Project decisions",
    detail: "Architecture choices, product decisions, and durable repo facts.",
    patterns: [/\barchitecture decision\b/i, /\bdecision\b/i, /\bdecided\b/i, /\bchose\b/i, /\bstandardi[sz]e\b/i, /\buse .+ for\b/i, /\buses .+ for\b/i, /\bADR\b/]
  },
  {
    id: "bug_fixes",
    title: "Bugs and fixes",
    detail: "Errors, regressions, fixes, and debugging outcomes.",
    patterns: [/\bbug\b/i, /\bfix(?:ed|es)?\b/i, /\berror\b/i, /\bcrash(?:ed|es)?\b/i, /\bregression\b/i, /\bresolved\b/i, /\bfailing test\b/i, /\bpatch\b/i]
  },
  {
    id: "tasks",
    title: "Tasks and loose ends",
    detail: "Follow-ups, pending work, reminders, and next steps.",
    patterns: [/\btodo\b/i, /\bfollow[- ]?up\b/i, /\bloose end\b/i, /\bnext step\b/i, /\bpending\b/i, /\bremember to\b/i, /\bbacklog\b/i]
  },
  {
    id: "people",
    title: "People and relationships",
    detail: "People, collaborators, clients, and relationship context.",
    patterns: [/\bteammate\b/i, /\bmanager\b/i, /\bcoworker\b/i, /\bfriend\b/i, /\bfamily\b/i, /\brelationship\b/i, /\bclient\b/i, /\bcustomer\b/i]
  },
  {
    id: "source_material",
    title: "Sources and bookmarks",
    detail: "URLs, docs, papers, videos, bookmarks, and saved references.",
    patterns: [/https?:\/\//i, /\bbookmark\b/i, /\byoutube\b/i, /\bx\.com\b/i, /\btwitter\b/i, /\barticle\b/i, /\bcitation\b/i, /\bpaper\b/i, /\bdocs?\b/i, /\bdocumentation\b/i]
  },
  {
    id: "coding_conventions",
    title: "Coding conventions",
    detail: "Naming, tests, frameworks, package managers, and repo norms.",
    patterns: [/\bconvention\b/i, /\bnaming\b/i, /\blint\b/i, /\bformatter\b/i, /\bprettier\b/i, /\beslint\b/i, /\btest strategy\b/i, /\bpackage manager\b/i, /\bruntime\b/i, /\bframework\b/i, /\btypescript\b/i, /\bnode\b/i, /\bpython\b/i]
  },
  {
    id: "repeated_failures",
    title: "Repeated failures",
    detail: "Failed attempts, repeated blockers, and known bad paths.",
    patterns: [/\btried\b/i, /\battempt\b/i, /\bfailed again\b/i, /\bkeeps failing\b/i, /\brecurring\b/i, /\bretry\b/i, /\bworkaround\b/i, /\bblocked\b/i]
  },
  {
    id: "hardware_experience",
    title: "Hardware experience",
    detail: "Robotics, devices, firmware, sensors, and calibration notes.",
    patterns: [/\brobot\b/i, /\bsensor\b/i, /\bmotor\b/i, /\bcalibration\b/i, /\bfirmware\b/i, /\barduino\b/i, /\besp32\b/i, /\bserial\b/i, /\bgpio\b/i, /\bmqtt\b/i, /\bros2?\b/i, /\bdevice\b/i]
  },
  {
    id: "customer_context",
    title: "Customer context",
    detail: "Support tickets, billing issues, account state, and resolutions.",
    patterns: [/\bsupport\b/i, /\bticket\b/i, /\baccount\b/i, /\bsubscription\b/i, /\bbilling\b/i, /\bescalation\b/i, /\bresolution\b/i, /\bSLA\b/i]
  }
];

const POLICY_TEMPLATES = {
  developer: {
    title: "Developer memory",
    remember: ["architecture decision", "repo convention", "bug fix", "deployment step", "test strategy", "api contract", "repeated failed attempt"],
    ignore: ["node_modules", "npm install output", "stack trace without fix", "build log without decision", "coverage output", "compiled asset"],
    askBeforeSaving: ["api key", "password", "secret", "private key", "token", "cross-project memory", "personal identity"],
    recallFirst: ["project_decisions", "coding_conventions", "bug_fixes", "repeated_failures"]
  },
  research: {
    title: "Research memory",
    remember: ["claim with source", "citation", "open question", "experiment result", "contradiction", "source summary"],
    ignore: ["unsourced conclusion", "duplicate excerpt", "temporary outline", "formatting note"],
    askBeforeSaving: ["confidential source", "private dataset", "personal identity", "api key", "password"],
    recallFirst: ["source_material", "project_decisions", "tasks"]
  },
  support: {
    title: "Support memory",
    remember: ["customer preference", "open issue", "resolution", "escalation", "account context"],
    ignore: ["greeting", "small talk", "raw transcript filler", "one-time password"],
    askBeforeSaving: ["credit card", "password", "ssn", "medical record", "private key"],
    recallFirst: ["customer_context", "people", "tasks"]
  },
  hardware: {
    title: "Hardware memory",
    remember: ["calibration result", "sensor failure", "firmware change", "successful fix", "environment constraint"],
    ignore: ["raw telemetry burst", "serial noise", "temporary voltage reading without outcome", "compile output"],
    askBeforeSaving: ["wifi password", "device token", "private key", "home address", "api key"],
    recallFirst: ["hardware_experience", "bug_fixes", "repeated_failures", "project_decisions"]
  },
  personal: {
    title: "Personal memory",
    remember: ["stable preference", "relationship context", "personal goal", "loose end", "important event"],
    ignore: ["throwaway note", "temporary mood", "duplicate reminder", "raw transcript filler"],
    askBeforeSaving: ["medical detail", "financial account", "government id", "password", "secret"],
    recallFirst: ["preferences", "people", "tasks"]
  },
  mixed: {
    title: "Mixed memory",
    remember: ["stable preference", "project decision", "source summary", "open task", "successful fix"],
    ignore: ["duplicate note", "temporary log", "raw stack trace", "compiled output"],
    askBeforeSaving: ["api key", "password", "secret", "private key", "personal identity"],
    recallFirst: ["preferences", "project_decisions", "tasks", "source_material"]
  }
};

export async function runGenome(options = {}) {
  const action = options.action ?? "show";
  if (!["show", "apply"].includes(action)) {
    throw new Error("Unknown genome action. Use: smctl genome or smctl genome apply");
  }

  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 100
  };
  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");

  const [analysis, inventory, activePolicy, project] = await Promise.all([
    analyzeMemory({
      baseUrl: context.baseUrl,
      home: context.home,
      fetch: context.fetch,
      limit: context.limit
    }),
    collectDocuments(context),
    readGenomePolicy(context.home),
    readProjectProfile(context.home)
  ]);
  const supermemoryProfile = await readSupermemoryProfile(context, project);
  const genome = buildGenome({ context, analysis, inventory, activePolicy, supermemoryProfile, project });
  const applyBlocked = action === "apply" && genome.exitCode !== 0;
  const applied = action === "apply" && !applyBlocked ? await writeGenomePolicy(context.home, genome.policy) : null;

  const result = {
    command: action === "apply" ? "genome apply" : "genome",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    sampled: inventory.documents.length,
    reachable: inventory.ok,
    score: genome.score,
    mode: genome.mode,
    categories: genome.categories,
    classified: genome.classified.slice(0, 12),
    quality: genome.quality,
    gaps: genome.gaps,
    policy: genome.policy,
    policyState: applied ? "installed" : genome.policyState,
    policyPath: redactHome(genomePolicyPath(context.home), context.home),
    supermemoryProfile,
    next: applied ? ["smctl guard inbox", "smctl ui"] : genome.next,
    applied: Boolean(applied),
    applyBlocked,
    exitCode: genome.exitCode
  };
  result.text = formatGenome(result);
  return attachSmartSections(result, options);
}

export async function readGenomePolicy(home = homedir()) {
  const path = genomePolicyPath(home);
  if (!await exists(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export function applyGenomePolicyToRequest(policy, request) {
  if (!policy) {
    return { findings: [], metadata: {}, containerTag: null, matchedType: null };
  }

  const text = requestText(request);
  const remembered = (policy.remember ?? []).find((item) => matchesPolicyText(text, item));
  const ignored = (policy.ignore ?? []).find((item) => matchesPolicyText(text, item));
  const sensitive = (policy.askBeforeSaving ?? []).find((item) => matchesPolicyText(text, item));
  const findings = [];

  if (ignored) {
    findings.push({
      severity: "medium",
      type: "genome-ignore",
      message: `Memory Genome marks this as likely noise for ${policy.title ?? policy.mode}: ${ignored}`
    });
  }
  if (sensitive) {
    findings.push({
      severity: isSensitiveHigh(sensitive) ? "high" : "medium",
      type: "genome-review",
      message: `Memory Genome asks for review before saving: ${sensitive}`
    });
  }

  return {
    findings,
    matchedType: remembered ?? null,
    containerTag: request.body?.containerTag ?? policy.defaultContainerTag ?? null,
    metadata: {
      smctlGenomeMode: policy.mode,
      smctlGenomeTitle: policy.title,
      smctlGenomePolicyVersion: policy.version,
      ...(remembered ? { smctlGenomeType: slug(remembered) } : {})
    }
  };
}

async function writeGenomePolicy(home, policy) {
  const path = genomePolicyPath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  return { path };
}

async function collectDocuments(context) {
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const sampled = list.body?.memories ?? list.body?.documents ?? [];
  const documents = [];
  for (const doc of sampled) {
    if (!doc?.id || hasUsefulText(doc) || documents.length >= Math.min(context.limit, 40)) {
      documents.push(doc);
      continue;
    }
    const detail = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${doc.id}`);
    documents.push(detail.ok && detail.body ? { ...doc, ...detail.body } : doc);
  }
  return {
    ok: list.ok,
    detail: responseDetail(list),
    documents
  };
}

async function readSupermemoryProfile(context, project) {
  const body = project?.containerTag ? { containerTag: project.containerTag } : {};
  const response = await postJson(context.fetch, `${context.baseUrl}/v4/profile`, body);
  const stats = response.ok ? profileStats(response.body) : { static: 0, dynamic: 0, buckets: 0, total: 0 };
  return {
    ok: response.ok,
    status: response.status,
    detail: responseDetail(response),
    stats
  };
}

function buildGenome({ context, analysis, inventory, activePolicy, supermemoryProfile, project }) {
  const classified = inventory.documents.map(classifyDocument);
  const categories = categorySummary(classified, inventory.documents.length);
  const mode = detectMode({ categories, topContainers: analysis.topContainers, project });
  const quality = {
    risky: analysis.quality.risky.length,
    vague: analysis.quality.vague.length,
    duplicates: analysis.quality.duplicates.length,
    missingAnchors: analysis.quality.missingAnchors.length,
    missingProject: analysis.quality.missingProject.length,
    failed: analysis.documents.failed.length,
    queued: analysis.documents.queued.length
  };
  const policy = buildPolicy({ mode, categories, quality, project, topContainers: analysis.topContainers });
  const gaps = buildGaps({ inventory, analysis, categories, mode, quality, supermemoryProfile, project });
  const score = scoreGenome({ inventory, gaps, quality, mode, supermemoryProfile });
  const policyState = activePolicy
    ? activePolicy.mode === policy.mode ? "installed" : "stale"
    : "not-installed";
  const next = nextSteps({ inventory, gaps, score, policyState });
  const exitCode = !inventory.ok || gaps.some((gap) => gap.status === "fail") ? 1 : 0;

  return {
    score,
    mode,
    categories,
    classified,
    quality,
    policy,
    gaps,
    policyState,
    next,
    exitCode,
    baseUrl: context.baseUrl
  };
}

function classifyDocument(doc) {
  const text = documentText(doc);
  const scores = [];
  for (const definition of CATEGORY_DEFINITIONS) {
    let score = 0;
    for (const pattern of definition.patterns) {
      if (pattern.test(text)) score += 1;
    }
    if (definition.id === "source_material" && hasSourceAnchor(doc)) score += 2;
    if (definition.id === "hardware_experience" && (doc.containerTags ?? []).some((tag) => String(tag).startsWith("hardware:"))) score += 2;
    if (definition.id === "project_decisions" && (doc.containerTags ?? []).some((tag) => String(tag).startsWith("project:"))) score += 1;
    if (definition.id === "customer_context" && (doc.containerTags ?? []).some((tag) => /support|customer|account/.test(String(tag)))) score += 2;
    if (score > 0) scores.push({ id: definition.id, title: definition.title, score });
  }
  scores.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return {
    id: doc.id,
    title: doc.title ?? doc.customId ?? "(untitled)",
    status: doc.status ?? "unknown",
    containerTags: doc.containerTags ?? [],
    primaryCategory: scores[0]?.id ?? "uncategorized",
    categories: scores.slice(0, 3)
  };
}

function categorySummary(classified, total) {
  return CATEGORY_DEFINITIONS.map((definition) => {
    const items = classified.filter((item) => item.categories.some((category) => category.id === definition.id));
    return {
      id: definition.id,
      title: definition.title,
      detail: definition.detail,
      count: items.length,
      percent: total > 0 ? Math.round((items.length / total) * 100) : 0,
      examples: items.slice(0, 3).map((item) => ({ id: item.id, title: item.title }))
    };
  }).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

function detectMode({ categories, topContainers, project }) {
  const count = (id) => categories.find((category) => category.id === id)?.count ?? 0;
  const containerBoost = (prefix) => topContainers.filter((item) => String(item.containerTag).startsWith(prefix)).reduce((sum, item) => sum + item.count, 0);
  const scores = {
    developer: count("project_decisions") + count("bug_fixes") + count("coding_conventions") + count("repeated_failures") + containerBoost("project:") + (project ? 2 : 0),
    research: count("source_material") + count("tasks"),
    support: count("customer_context") + count("people"),
    hardware: count("hardware_experience") + containerBoost("hardware:"),
    personal: count("preferences") + count("people") + count("tasks")
  };
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [mode, value] = sorted[0] ?? ["mixed", 0];
  const total = Object.values(scores).reduce((sum, item) => sum + item, 0);
  if (value === 0 || total === 0) {
    return { id: "mixed", title: POLICY_TEMPLATES.mixed.title, confidence: 0.25, scores };
  }
  const confidence = Math.max(0.25, Math.min(0.98, value / total));
  return {
    id: confidence < 0.34 ? "mixed" : mode,
    title: POLICY_TEMPLATES[confidence < 0.34 ? "mixed" : mode].title,
    confidence: Number(confidence.toFixed(2)),
    scores
  };
}

function buildPolicy({ mode, categories, quality, project, topContainers }) {
  const template = POLICY_TEMPLATES[mode.id] ?? POLICY_TEMPLATES.mixed;
  const dominant = categories.filter((category) => category.count > 0).slice(0, 4).map((category) => category.id);
  const topContainer = project?.containerTag
    ?? topContainers.find((item) => item.containerTag && item.containerTag !== "untagged")?.containerTag
    ?? null;
  const remember = unique([...template.remember, ...dominant.map((id) => categoryTitle(id))]);
  const askBeforeSaving = unique([
    ...template.askBeforeSaving,
    ...(quality.risky > 0 ? ["anything that looks like a credential"] : []),
    ...(quality.missingProject > 0 ? ["cross-project memory"] : [])
  ]);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "smctl genome",
    mode: mode.id,
    title: template.title,
    confidence: mode.confidence,
    defaultContainerTag: topContainer,
    remember,
    ignore: template.ignore,
    askBeforeSaving,
    recallFirst: template.recallFirst,
    metadata: {
      smctlGenomeMode: mode.id,
      smctlGenomeConfidence: mode.confidence
    }
  };
}

function buildGaps({ inventory, analysis, categories, mode, quality, supermemoryProfile, project }) {
  if (!inventory.ok) {
    return [fail("Memory inventory unavailable", inventory.detail, "smctl doctor")];
  }
  const gaps = [];
  if (inventory.documents.length === 0) {
    gaps.push(warn("No memories sampled", "Genome needs stored memories before it can personalize behavior.", "smctl verify"));
  }
  if (quality.failed > 0) gaps.push(fail("Failed writes poison the profile", `${quality.failed} failed document(s) in the sample.`, "smctl repair wizard"));
  if (quality.risky > 0) gaps.push(fail("Sensitive memories need review", `${quality.risky} sampled item(s) look secret-like.`, "smctl cleanup"));
  if (quality.vague > 0) gaps.push(warn("Vague memories reduce personalization", `${quality.vague} sampled item(s) are too vague to steer future agents.`, "smctl memory coach"));
  if (quality.missingAnchors > 0) gaps.push(warn("Source grounding is thin", `${quality.missingAnchors} sampled item(s) have no URL, filepath, source, or migration ID.`, "smctl memory coach"));
  if (quality.missingProject > 0 && project) gaps.push(warn("Project memory is drifting", `${quality.missingProject} item(s) are outside ${project.containerTag}.`, "smctl start"));
  if (analysis.quality.contradictions.length > 0) gaps.push(warn("Contradictions need review", `${analysis.quality.contradictions.length} conflict group(s) can personalize agents incorrectly.`, "smctl memory coach"));
  if (!supermemoryProfile.ok) {
    gaps.push(warn("Supermemory profile endpoint unavailable", supermemoryProfile.detail, "smctl doctor"));
  } else if (supermemoryProfile.stats.total === 0 && inventory.documents.length > 0) {
    gaps.push(warn("Profile has not learned stable facts yet", "Documents exist, but /v4/profile returned no static, dynamic, or bucketed facts.", "smctl trust --probe"));
  }
  if (mode.id === "developer" && categoryCount(categories, "coding_conventions") === 0) {
    gaps.push(warn("Developer conventions are missing", "Store repo naming, testing, and architecture conventions so coding agents can act consistently.", "smctl memory coach"));
  }
  if (mode.id === "research" && categoryCount(categories, "source_material") < 2) {
    gaps.push(warn("Research memory needs more sources", "Research personalization is weak without cited source memories.", "smctl memory coach"));
  }
  if (mode.id === "hardware" && categoryCount(categories, "repeated_failures") === 0) {
    gaps.push(warn("Hardware memory lacks failure history", "Store failed runs and fixes so future tests avoid repeated mistakes.", "smctl hardware observe"));
  }
  if (gaps.length === 0) {
    gaps.push(ok("Memory Genome is actionable", "The sampled memory mix is specific enough to drive Guard and agent personalization.", "smctl genome apply"));
  }
  return gaps;
}

function scoreGenome({ inventory, gaps, quality, mode, supermemoryProfile }) {
  if (!inventory.ok) {
    return {
      value: 20,
      label: "Blocked",
      detail: "Harness cannot read the memory inventory, so it cannot personalize Supermemory safely."
    };
  }
  let value = inventory.documents.length > 0 ? 100 : 45;
  for (const gap of gaps) {
    if (gap.status === "fail") value -= 20;
    if (gap.status === "warn") value -= 8;
  }
  if (mode.confidence < 0.4) value -= 8;
  if (quality.duplicates > 0) value -= Math.min(10, quality.duplicates * 3);
  if (!supermemoryProfile.ok) value -= 5;
  value = Math.max(0, Math.min(100, value));
  return {
    value,
    label: value >= 85 ? "Personalized" : value >= 65 ? "Usable" : value >= 40 ? "Thin" : "Blocked",
    detail: value >= 85
      ? "The sampled memories are specific enough to generate a strong local personalization policy."
      : "The genome is useful, but the sample has quality gaps that can weaken personalization."
  };
}

function nextSteps({ inventory, gaps, score, policyState }) {
  const commands = [];
  for (const gap of gaps) {
    if (gap.command && !commands.includes(gap.command)) commands.push(gap.command);
  }
  if (inventory.ok && score.value >= 50 && policyState !== "installed") commands.unshift("smctl genome apply");
  if (!commands.includes("smctl ui")) commands.push("smctl ui");
  return unique(commands).slice(0, 5);
}

function formatGenome(result) {
  const lines = [];
  lines.push("Supermemory Harness Memory Genome");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Sampled: ${result.sampled} documents`);
  lines.push(`Genome score: ${result.score.value}/100 (${result.score.label})`);
  lines.push(`Primary mode: ${result.mode.title} (${Math.round(result.mode.confidence * 100)}% confidence)`);
  lines.push(`Policy: ${result.policyState} at ${result.policyPath}`);
  lines.push(`Profile API: ${result.supermemoryProfile.detail}; facts ${result.supermemoryProfile.stats.total}`);
  lines.push("");
  lines.push(result.score.detail);
  lines.push("");

  lines.push("Memory types stored:");
  for (const category of result.categories.filter((item) => item.count > 0).slice(0, 8)) {
    lines.push(`   ${category.title}: ${category.count} (${category.percent}%)`);
    if (category.examples.length > 0) {
      lines.push(`      e.g. ${category.examples.map((item) => item.title).join(" | ")}`);
    }
  }
  if (result.categories.every((item) => item.count === 0)) {
    lines.push("   No recognizable memory types found yet.");
  }
  lines.push("");

  lines.push("Personalization gaps:");
  for (const gap of result.gaps.slice(0, 8)) {
    lines.push(`${symbol(gap.status)} ${gap.title}`);
    if (gap.detail) lines.push(`   ${gap.detail}`);
    if (gap.command) lines.push(`   Next: ${gap.command}`);
  }
  lines.push("");

  lines.push("Generated policy:");
  lines.push(`   Mode: ${result.policy.title}`);
  lines.push(`   Default container: ${result.policy.defaultContainerTag ?? "none"}`);
  lines.push(`   Remember: ${result.policy.remember.slice(0, 8).join(", ")}`);
  lines.push(`   Ignore: ${result.policy.ignore.slice(0, 6).join(", ")}`);
  lines.push(`   Ask before saving: ${result.policy.askBeforeSaving.slice(0, 6).join(", ")}`);
  lines.push(`   Recall first: ${result.policy.recallFirst.join(", ")}`);
  lines.push("");

  lines.push("Recommended:");
  for (const command of result.next) lines.push(`   ${command}`);
  lines.push("");
  lines.push(result.applied
    ? "Result: Memory Genome policy installed. Guard will use it for future writes."
    : result.applyBlocked
      ? "Result: Memory Genome policy was not installed because blocking memory issues must be fixed first."
      : result.exitCode === 0
      ? "Result: Memory Genome is ready. Run smctl genome apply to personalize Guard."
      : "Result: fix blocking memory quality issues before relying on personalization.");
  return lines.join("\n");
}

function profileStats(body) {
  const profile = body?.profile ?? body ?? {};
  const staticFacts = Array.isArray(profile.static) ? profile.static.length : 0;
  const dynamicFacts = Array.isArray(profile.dynamic) ? profile.dynamic.length : 0;
  const bucketValue = profile.buckets ?? profile.profileBuckets ?? profile.profile_buckets ?? [];
  const buckets = Array.isArray(bucketValue)
    ? bucketValue.length
    : bucketValue && typeof bucketValue === "object" ? Object.keys(bucketValue).length : 0;
  const bucketFacts = Array.isArray(bucketValue)
    ? bucketValue.reduce((sum, bucket) => sum + countBucketFacts(bucket), 0)
    : bucketValue && typeof bucketValue === "object" ? Object.values(bucketValue).reduce((sum, bucket) => sum + countBucketFacts(bucket), 0) : 0;
  return {
    static: staticFacts,
    dynamic: dynamicFacts,
    buckets,
    total: staticFacts + dynamicFacts + bucketFacts
  };
}

function countBucketFacts(bucket) {
  if (Array.isArray(bucket)) return bucket.length;
  if (bucket && typeof bucket === "object") {
    if (Array.isArray(bucket.memories)) return bucket.memories.length;
    if (Array.isArray(bucket.facts)) return bucket.facts.length;
    return Object.values(bucket).filter((value) => typeof value === "string").length;
  }
  return bucket ? 1 : 0;
}

function documentText(doc) {
  return [
    doc.title,
    doc.content,
    doc.raw,
    doc.description,
    doc.customId,
    doc.url,
    doc.filepath,
    ...(doc.containerTags ?? []),
    JSON.stringify(doc.metadata ?? {})
  ].filter(Boolean).join("\n");
}

function requestText(request) {
  return JSON.stringify(request.body ?? {}).toLowerCase();
}

function hasUsefulText(doc) {
  return Boolean(String(doc.content ?? doc.raw ?? doc.description ?? "").trim());
}

function hasSourceAnchor(doc) {
  const metadata = doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
  return Boolean(
    doc.url
    || doc.filepath
    || (doc.source && doc.source !== "supermemory-local")
    || metadata.url
    || metadata.filepath
    || metadata.source
    || metadata.smctlLocalId
  );
}

function categoryCount(categories, id) {
  return categories.find((category) => category.id === id)?.count ?? 0;
}

function categoryTitle(id) {
  return CATEGORY_DEFINITIONS.find((category) => category.id === id)?.title.toLowerCase() ?? id;
}

function matchesPolicyText(text, phrase) {
  const normalized = String(phrase ?? "").toLowerCase();
  if (!normalized) return false;
  if (text.includes(normalized)) return true;
  if (normalized.includes("stack trace")) return /stack trace|at\s+\S+\s+\(|traceback/i.test(text);
  if (normalized.includes("api key")) return /api[_-]?key|sk-|AIza|sm_/i.test(text);
  if (normalized.includes("private key")) return /private key/i.test(text);
  if (normalized.includes("token")) return /\btoken\b|gh[pousr]_|xox[baprs]-/i.test(text);
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["without", "before", "saving", "memory"].includes(word));
  return words.slice(0, 3).some((word) => text.includes(word));
}

function isSensitiveHigh(value) {
  return /api key|password|secret|private key|token|credit card|ssn|medical|government id/i.test(value);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function genomePolicyPath(home) {
  return join(home, ".config", "smctl", "genome", "policy.json");
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
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
      body: parseJson(text),
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

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
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

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
