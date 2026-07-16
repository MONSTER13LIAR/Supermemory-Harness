import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { normalizeBaseUrl } from "./insights.js";

const DEFAULT_CLOUD_URL = "https://api.supermemory.ai";
const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{16,}/,
  /\bsk-ant-[a-zA-Z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /BEGIN (RSA |OPENSSH |EC |)?PRIVATE KEY/,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]{8,}/i
];

export async function runMigrate(options = {}) {
  const action = options.action ?? "plan";
  if (action === "plan") return migratePlan(options);
  if (action === "cloud") return migrateCloud(options);
  if (action === "verify") return migrateVerify(options);
  if (action === "receipt") return migrateReceipt(options);
  throw new Error("Unknown migrate action. Use: smctl migrate plan|cloud|verify|receipt");
}

export async function migratePlan(options = {}) {
  const context = migrationContext(options);
  const inventory = await collectLocalInventory(context);
  const plan = buildMigrationPlan(inventory);
  const result = {
    command: "migrate plan",
    generatedAt: new Date().toISOString(),
    localUrl: context.baseUrl,
    cloudUrl: context.cloudUrl,
    plan,
    exitCode: plan.blockers.length > 0 ? 1 : 0
  };
  result.text = formatMigrationPlan(result);
  return result;
}

export async function migrateCloud(options = {}) {
  const context = migrationContext(options);
  const inventory = await collectLocalInventory(context);
  const plan = buildMigrationPlan(inventory);
  const apply = Boolean(options.apply) && !options.dryRun;
  const actions = [];

  if (!apply) {
    const result = {
      command: "migrate cloud",
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      localUrl: context.baseUrl,
      cloudUrl: context.cloudUrl,
      plan,
      actions,
      receiptPath: null,
      exitCode: plan.blockers.length > 0 ? 1 : 0
    };
    result.text = formatMigrationCloud(result);
    return result;
  }

  if (!context.cloudApiKey) {
    const result = {
      command: "migrate cloud",
      generatedAt: new Date().toISOString(),
      mode: "apply",
      localUrl: context.baseUrl,
      cloudUrl: context.cloudUrl,
      plan,
      actions: [],
      receiptPath: null,
      exitCode: 1
    };
    result.text = [
      "Supermemory Harness cloud migration",
      "Mode: apply",
      "[fail] Cloud API key missing",
      `   Set ${context.cloudApiKeyEnv} or pass --cloud-api-key-env <name>.`,
      "",
      "Result: migration did not start."
    ].join("\n");
    return result;
  }

  for (const item of plan.items) {
    if (item.decision !== "migrate") {
      actions.push({
        status: "skipped",
        localId: item.localId,
        title: item.title,
        reason: item.reason
      });
      continue;
    }

    const response = await postJson(context.fetch, `${context.cloudUrl}/v3/documents`, migrationPayload(item), {
      authorization: `Bearer ${context.cloudApiKey}`
    });
    actions.push({
      status: response.ok ? "migrated" : "failed",
      localId: item.localId,
      cloudId: response.body?.id,
      title: item.title,
      containerTag: item.containerTag,
      reason: response.ok ? "Uploaded to cloud" : responseDetail(response)
    });
  }

  const summary = summarizeActions(actions);
  const receipt = {
    command: "migrate cloud",
    generatedAt: new Date().toISOString(),
    localUrl: context.baseUrl,
    cloudUrl: context.cloudUrl,
    sourceFingerprint: inventory.fingerprint,
    plan: plan.summary,
    summary,
    actions
  };
  const receiptPath = await writeReceipt(context.home, receipt);
  const result = {
    ...receipt,
    mode: "apply",
    receiptPath,
    exitCode: summary.failed > 0 ? 1 : 0
  };
  result.text = formatMigrationCloud(result);
  return result;
}

export async function migrateVerify(options = {}) {
  const context = migrationContext(options);
  const receipt = await readLatestReceipt(context.home);
  if (!receipt) {
    const result = {
      command: "migrate verify",
      generatedAt: new Date().toISOString(),
      checks: [{ status: "fail", title: "No migration receipt found", detail: "Run smctl migrate cloud --apply first." }],
      exitCode: 1
    };
    result.text = formatMigrationVerify(result);
    return result;
  }

  const migrated = (receipt.actions ?? []).filter((action) => action.status === "migrated").slice(0, 5);
  const checks = [];
  if (migrated.length === 0) {
    checks.push({ status: "fail", title: "No migrated items in receipt", detail: receipt.generatedAt });
  }

  for (const item of migrated) {
    const query = item.title || item.localId;
    const response = await postJson(context.fetch, `${context.cloudUrl}/v3/search`, {
      q: query,
      limit: 5,
      ...(item.containerTag ? { containerTags: [item.containerTag] } : {})
    }, context.cloudApiKey ? { authorization: `Bearer ${context.cloudApiKey}` } : {});
    const bodyText = JSON.stringify(response.body ?? {});
    checks.push({
      status: response.ok && bodyText.includes(item.cloudId ?? item.title) ? "ok" : "warn",
      title: `Recall check: ${item.title}`,
      detail: response.ok ? "Cloud search responded; inspect results if recall is weak." : responseDetail(response)
    });
  }

  const result = {
    command: "migrate verify",
    generatedAt: new Date().toISOString(),
    cloudUrl: context.cloudUrl,
    receiptGeneratedAt: receipt.generatedAt,
    checks,
    exitCode: checks.some((check) => check.status === "fail") ? 1 : 0
  };
  result.text = formatMigrationVerify(result);
  return result;
}

export async function migrateReceipt(options = {}) {
  const context = migrationContext(options);
  const receipt = await readLatestReceipt(context.home);
  const result = {
    command: "migrate receipt",
    generatedAt: new Date().toISOString(),
    receipt,
    exitCode: receipt ? 0 : 1
  };
  result.text = receipt
    ? formatReceipt(receipt)
    : "Supermemory Harness migration receipt\n[fail] No migration receipt found";
  return result;
}

function migrationContext(options) {
  const env = options.env ?? process.env;
  const cloudApiKeyEnv = options.cloudApiKeyEnv ?? "SUPERMEMORY_CLOUD_API_KEY";
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    cloudUrl: normalizeBaseUrl(options.cloudUrl ?? env.SUPERMEMORY_CLOUD_URL ?? DEFAULT_CLOUD_URL),
    cloudApiKeyEnv,
    cloudApiKey: env[cloudApiKeyEnv] ?? null,
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    limit: options.limit ?? 100
  };
  if (!context.fetch) throw new Error("Fetch API unavailable; Node 22+ is required");
  return context;
}

async function collectLocalInventory(context) {
  const list = await postJson(context.fetch, `${context.baseUrl}/v3/documents/list`, {
    limit: context.limit,
    page: 1,
    sort: "updatedAt",
    order: "desc"
  });
  const sampled = list.body?.memories ?? list.body?.documents ?? [];
  const documents = [];

  for (const doc of sampled) {
    if (!doc.id) {
      documents.push(doc);
      continue;
    }
    const detail = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${doc.id}`);
    documents.push(detail.ok && detail.body ? { ...doc, ...detail.body } : doc);
  }

  return {
    ok: list.ok,
    detail: responseDetail(list),
    documents,
    fingerprint: fingerprintDocuments(documents)
  };
}

export function buildMigrationPlan(inventory) {
  const blockers = [];
  if (!inventory.ok) {
    blockers.push({
      title: "Local document inventory unavailable",
      detail: inventory.detail
    });
  }

  const seen = new Set();
  const items = [];
  for (const doc of inventory.documents ?? []) {
    const content = extractContent(doc);
    const title = doc.title ?? doc.customId ?? "(untitled)";
    const containerTag = firstContainerTag(doc);
    const hash = hashText(`${title}\n${content}`);
    const duplicate = seen.has(hash);
    seen.add(hash);
    const risky = hasSecretRisk(doc);
    const failed = ["failed", "error"].includes(doc.status);
    const empty = !content;
    const decision = risky || failed || empty || duplicate ? "hold" : "migrate";
    const reason = risky
      ? "Possible secret or credential"
      : failed
        ? `Local status is ${doc.status}`
        : empty
          ? "No exportable text content"
          : duplicate
            ? "Duplicate-looking content"
            : "Ready for cloud upload";
    items.push({
      localId: doc.id ?? hash,
      title,
      content,
      contentHash: hash,
      status: doc.status ?? "unknown",
      containerTag,
      containerTags: doc.containerTags ?? (containerTag ? [containerTag] : []),
      source: doc.source ?? "supermemory-local",
      url: doc.url,
      filepath: doc.filepath,
      createdAt: doc.createdAt ?? doc.created_at,
      updatedAt: doc.updatedAt ?? doc.updated_at,
      metadata: doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {},
      decision,
      reason
    });
  }

  const summary = {
    sampled: items.length,
    migratable: items.filter((item) => item.decision === "migrate").length,
    held: items.filter((item) => item.decision === "hold").length,
    failedLocal: items.filter((item) => ["failed", "error"].includes(item.status)).length,
    risky: items.filter((item) => item.reason.includes("secret")).length,
    duplicates: items.filter((item) => item.reason.includes("Duplicate")).length,
    projects: unique(items.flatMap((item) => item.containerTags)).length
  };

  return {
    summary,
    blockers,
    items,
    held: items.filter((item) => item.decision === "hold"),
    migratable: items.filter((item) => item.decision === "migrate")
  };
}

function migrationPayload(item) {
  return {
    content: item.content,
    title: item.title,
    ...(item.containerTag ? { containerTag: item.containerTag } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.filepath ? { filepath: item.filepath } : {}),
    metadata: {
      ...item.metadata,
      smctlMigration: true,
      smctlMigrationSource: "supermemory-local",
      smctlLocalId: item.localId,
      smctlLocalStatus: item.status,
      smctlContentHash: item.contentHash,
      smctlMigratedAt: new Date().toISOString(),
      ...(item.createdAt ? { smctlLocalCreatedAt: item.createdAt } : {}),
      ...(item.updatedAt ? { smctlLocalUpdatedAt: item.updatedAt } : {})
    }
  };
}

async function writeReceipt(home, receipt) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(home, ".config", "smctl", "migrations");
  const path = join(directory, `${stamp}.json`);
  const latestPath = join(directory, "latest.json");
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(receipt, null, 2);
  await writeFile(path, content);
  await writeFile(latestPath, content);
  return path;
}

async function readLatestReceipt(home) {
  const indexPath = join(home, ".config", "smctl", "migrations", "latest.json");
  try {
    return JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return null;
  }
}

function formatMigrationPlan(result) {
  const lines = [];
  lines.push("Supermemory Harness migration plan");
  lines.push(`Local: ${result.localUrl}`);
  lines.push(`Cloud: ${result.cloudUrl}`);
  lines.push(`Sample: ${result.plan.summary.sampled} local documents`);
  lines.push(`Ready: ${result.plan.summary.migratable}; held: ${result.plan.summary.held}; projects: ${result.plan.summary.projects}`);
  lines.push("");
  if (result.plan.blockers.length > 0) {
    for (const blocker of result.plan.blockers) {
      lines.push(`[fail] ${blocker.title}`);
      lines.push(`   ${blocker.detail}`);
    }
  } else {
    lines.push("[ok] Local inventory collected");
  }
  if (result.plan.held.length > 0) {
    lines.push("");
    lines.push("Held back:");
    for (const item of result.plan.held.slice(0, 8)) {
      lines.push(`   ${item.localId}  ${item.title} (${item.reason})`);
    }
  }
  lines.push("");
  lines.push("Next: smctl migrate cloud --dry-run, then smctl migrate cloud --apply after review.");
  return lines.join("\n");
}

function formatMigrationCloud(result) {
  const lines = [];
  lines.push("Supermemory Harness cloud migration");
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Local: ${result.localUrl}`);
  lines.push(`Cloud: ${result.cloudUrl}`);
  lines.push(`Ready: ${result.plan?.summary?.migratable ?? result.summary?.migrated ?? 0}; held: ${result.plan?.summary?.held ?? 0}`);
  lines.push("");
  if (result.mode === "dry-run") {
    lines.push("No cloud writes were made.");
    if ((result.plan?.migratable ?? []).length > 0) {
      lines.push("Would migrate:");
      for (const item of result.plan.migratable.slice(0, 8)) {
        lines.push(`   ${item.localId}  ${item.title}${item.containerTag ? ` [${item.containerTag}]` : ""}`);
      }
    }
    lines.push("");
    lines.push("Apply: smctl migrate cloud --apply");
    return lines.join("\n");
  }

  lines.push(`Summary: ${result.summary.migrated} migrated, ${result.summary.skipped} skipped, ${result.summary.failed} failed`);
  for (const action of (result.actions ?? []).slice(0, 12)) {
    lines.push(`${action.status === "migrated" ? "[ok]" : action.status === "skipped" ? "[warn]" : "[fail]"} ${action.localId}  ${action.title}`);
    lines.push(`   ${action.reason}`);
  }
  if (result.receiptPath) {
    lines.push("");
    lines.push(`Receipt: ${result.receiptPath}`);
    lines.push("Verify: smctl migrate verify");
  }
  return lines.join("\n");
}

function formatMigrationVerify(result) {
  const lines = [];
  lines.push("Supermemory Harness migration verify");
  if (result.cloudUrl) lines.push(`Cloud: ${result.cloudUrl}`);
  for (const check of result.checks) {
    lines.push(`${check.status === "ok" ? "[ok]" : check.status === "warn" ? "[warn]" : "[fail]"} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  return lines.join("\n");
}

function formatReceipt(receipt) {
  const lines = [];
  lines.push("Supermemory Harness migration receipt");
  lines.push(`Generated: ${receipt.generatedAt}`);
  lines.push(`Local: ${receipt.localUrl}`);
  lines.push(`Cloud: ${receipt.cloudUrl}`);
  lines.push(`Summary: ${receipt.summary.migrated} migrated, ${receipt.summary.skipped} skipped, ${receipt.summary.failed} failed`);
  return lines.join("\n");
}

function summarizeActions(actions) {
  return {
    migrated: actions.filter((action) => action.status === "migrated").length,
    skipped: actions.filter((action) => action.status === "skipped").length,
    failed: actions.filter((action) => action.status === "failed").length
  };
}

function extractContent(doc) {
  return String(doc.content ?? doc.raw ?? doc.memory ?? "").trim();
}

function firstContainerTag(doc) {
  const tags = doc.containerTags ?? doc.container_tags ?? [];
  return Array.isArray(tags) ? tags[0] : null;
}

function hasSecretRisk(doc) {
  const text = `${doc.title ?? ""}\n${doc.content ?? ""}\n${doc.raw ?? ""}\n${doc.memory ?? ""}`;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function fingerprintDocuments(documents) {
  return hashText(JSON.stringify(documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    status: doc.status,
    contentHash: hashText(extractContent(doc))
  }))));
}

function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

async function postJson(fetchFn, url, body, headers = {}) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers.authorization ? { authorization: headers.authorization } : {})
    },
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
      signal: AbortSignal.timeout(8000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: error.message
    };
  }
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (!response.status) return "request failed";
  const body = response.body ? JSON.stringify(response.body).slice(0, 240) : "";
  return `HTTP ${response.status}${body ? `: ${body}` : ""}`;
}
