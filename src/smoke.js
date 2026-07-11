import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const TERMINAL_STATUSES = new Set(["done", "failed", "error"]);

export async function runSmoke(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    containerTag: options.containerTag ?? "smctl-smoke",
    timeoutMs: options.timeoutMs ?? 30000,
    home: options.home ?? homedir(),
    fetch: options.fetch ?? globalThis.fetch,
    sleep: options.sleep ?? sleep
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const marker = options.marker ?? `smctl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const content = [
    "Supermemory Harness smoke test.",
    `Marker: ${marker}`,
    "This harmless document verifies local ingest, processing, and recall."
  ].join(" ");

  const add = await postJson(context.fetch, `${context.baseUrl}/v3/documents`, {
    content,
    containerTag: context.containerTag,
    customId: marker,
    metadata: {
      source: "smctl-smoke",
      marker
    }
  });

  const documentId = add.body?.id ?? null;
  const addStatus = add.body?.status ?? "unknown";
  const checks = [
    add.ok
      ? ok("Document accepted", `id ${documentId}, status ${addStatus}`)
      : fail("Document ingest request failed", responseDetail(add))
  ];

  let document = null;
  if (add.ok && documentId) {
    document = await waitForDocument(context, documentId, startedAt);
    if (document.timedOut) {
      checks.push(fail("Document processing timed out", `last status ${document.status ?? "unknown"}`));
    } else if (document.status === "done") {
      checks.push(ok("Document processing completed", `status ${document.status}`));
    } else {
      checks.push(fail("Document processing did not complete", `status ${document.status ?? "unknown"}`));
    }
  }

  let search = null;
  if (document?.status === "done") {
    search = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
      q: marker,
      containerTag: context.containerTag,
      limit: 5,
      includeFullDocs: true
    });
    const found = search.ok && JSON.stringify(search.body).includes(marker);
    checks.push(found
      ? ok("Search recalled the marker", `${search.body?.total ?? 0} result(s)`)
      : fail("Search did not recall the marker", responseDetail(search)));
  }

  const logHint = documentId ? await latestLogHint(context.home, documentId) : null;
  if (logHint) {
    checks.push(info("Latest server log hint", logHint));
  }

  const summary = summarize(checks);
  const result = {
    command: "smoke",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    containerTag: context.containerTag,
    marker,
    documentId,
    documentStatus: document?.status ?? addStatus,
    elapsedMs: Date.now() - startedAt,
    summary,
    checks,
    exitCode: summary.fail > 0 ? 1 : 0,
    searchTotal: search?.body?.total
  };
  result.text = formatSmoke(result);
  return result;
}

async function waitForDocument(context, documentId, startedAt) {
  let latest = { status: "unknown" };
  while (Date.now() - startedAt < context.timeoutMs) {
    const response = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${documentId}`);
    if (response.ok) {
      latest = response.body ?? latest;
      if (TERMINAL_STATUSES.has(latest.status)) {
        return latest;
      }
    }
    await context.sleep(1000);
  }

  return {
    ...latest,
    timedOut: true
  };
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

async function latestLogHint(home, documentId) {
  const path = join(home, ".supermemory", "server.log");
  try {
    const content = await readFile(path, "utf8");
    const documentLines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(documentId))
      .filter(Boolean);
    return documentLines.findLast((line) => /failed|error/i.test(line)) ?? documentLines.at(-1) ?? null;
  } catch {
    return null;
  }
}

function formatSmoke(result) {
  const lines = [];
  lines.push("Supermemory Harness smoke");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Container: ${result.containerTag}`);
  lines.push(`Marker: ${result.marker}`);
  if (result.documentId) {
    lines.push(`Document: ${result.documentId}`);
  }
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.fail} fail, ${result.summary.info} info`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) {
      lines.push(`   ${check.detail}`);
    }
  }

  lines.push("");
  if (result.summary.fail > 0) {
    lines.push("Result: Supermemory ingest/recall pipeline is not fully healthy.");
  } else {
    lines.push("Result: Supermemory ingest/recall pipeline works end to end.");
  }
  return lines.join("\n");
}

function responseDetail(response) {
  if (response.error) return response.error;
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, fail: 0, info: 0 });
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

function info(title, detail) {
  return { status: "info", title, detail };
}

function symbol(status) {
  if (status === "ok") return "[ok]";
  if (status === "fail") return "[fail]";
  return "[info]";
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) {
    return `${error.message}: ${cause.code}`;
  }
  return error.message;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
