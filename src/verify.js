import { homedir } from "node:os";
import { appendExplanation, explainHarnessResult } from "./local-brain.js";
import { runSmoke } from "./smoke.js";
import { readProjectProfile } from "./project.js";

export async function runVerify(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? 30000,
    language: options.language ?? "multilingual",
    sleep: options.sleep
  };

  if (!context.fetch) {
    throw new Error("Fetch API unavailable; Node 22+ is required");
  }

  const profile = await readProjectProfile(context.home);
  const containerTag = options.containerTag ?? profile?.containerTag ?? "smctl-verify";
  const marker = options.marker ?? `smctl_verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const checks = [];

  const projectCheck = profile
    ? ok("Project scope detected", `${profile.name} -> ${containerTag}`)
    : warn("Project scope not initialized", "Run smctl init to separate memories by project");
  checks.push(projectCheck);

  const smoke = await runSmoke({
    baseUrl: context.baseUrl,
    home: context.home,
    fetch: context.fetch,
    containerTag,
    timeoutMs: context.timeoutMs,
    marker,
    sleep: context.sleep
  });
  checks.push(smoke.exitCode === 0
    ? ok("Write and recall path", `marker ${marker} found`)
    : fail("Write and recall path", "Supermemory accepted or processed the marker incorrectly"));

  const containerProbe = await probeContainerSearch(context, containerTag, marker);
  checks.push(containerProbe.foundInContainer
    ? ok("Container-scoped recall", containerTag)
    : fail("Container-scoped recall", containerProbe.detail));

  if (containerProbe.unscopedFound && !containerProbe.foundInContainer) {
    checks.push(warn("Possible container mismatch", "Memory appears searchable without the expected project container"));
  }

  const canaries = await recallCanarySuite(context, containerTag, marker);
  checks.push(...canaries.checks);

  const language = await languageProbe(context, containerTag, options.languageMarker);
  checks.push(language.status === "ok"
    ? ok("Language recall probe", language.detail)
    : warn("Language recall probe", language.detail));

  const summary = summarize(checks);
  const result = {
    command: "verify",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    containerTag,
    marker,
    profile,
    smoke: {
      exitCode: smoke.exitCode,
      documentId: smoke.documentId,
      documentStatus: smoke.documentStatus,
      elapsedMs: smoke.elapsedMs
    },
    language,
    canaries: canaries.results,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatVerify(result);
  if (options.explain) {
    result.explanation = await explainHarnessResult(result, {
      fetch: context.fetch,
      ollamaModel: options.ollamaModel
    });
    result.text = appendExplanation(result.text, result.explanation);
  }
  return result;
}

async function recallCanarySuite(context, containerTag, marker) {
  const semanticPhrase = `Harness canary durable decision ${marker}`;
  const wrongContainer = `${containerTag}:wrong-scope`;
  const probes = [
    {
      name: "exact scoped recall",
      query: marker,
      containerTag,
      expectFound: true
    },
    {
      name: "semantic scoped recall",
      query: "durable decision harness canary",
      containerTag,
      expectFound: true
    },
    {
      name: "negative recall control",
      query: `absent-${marker}`,
      containerTag,
      expectFound: false
    },
    {
      name: "cross-container isolation",
      query: marker,
      containerTag: wrongContainer,
      expectFound: false
    }
  ];

  const add = await postJson(context.fetch, `${context.baseUrl}/v3/documents`, {
    content: [
      "Supermemory Harness recall canary.",
      `Exact marker: ${marker}.`,
      semanticPhrase,
      "This document verifies scoped exact recall, semantic recall, negative controls, and cross-container isolation."
    ].join(" "),
    containerTag,
    customId: `smctl-canary-${marker}`,
    metadata: {
      source: "smctl-verify",
      smctlProbe: "recall-canary",
      marker
    }
  });

  if (!add.ok || !add.body?.id) {
    return {
      checks: [warn("Recall canary suite", `canary write skipped: ${responseDetail(add)}`)],
      results: []
    };
  }

  const doc = await waitForDocument(context, add.body.id, Date.now());
  if (doc.status !== "done") {
    return {
      checks: [warn("Recall canary suite", `canary document status ${doc.status ?? "unknown"}`)],
      results: [{ id: add.body.id, status: doc.status ?? "unknown" }]
    };
  }

  const results = [];
  for (const probe of probes) {
    const response = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
      q: probe.query,
      containerTag: probe.containerTag,
      limit: 5,
      includeFullDocs: true
    });
    const text = JSON.stringify(response.body ?? {});
    const found = response.ok && text.includes(marker);
    const passed = probe.expectFound ? found : !found;
    results.push({
      name: probe.name,
      query: probe.query,
      containerTag: probe.containerTag,
      expectFound: probe.expectFound,
      found,
      passed,
      detail: responseDetail(response)
    });
  }

  const failed = results.filter((result) => !result.passed);
  return {
    results,
    checks: failed.length === 0
      ? [ok("Recall canary suite", "exact, semantic, negative, and cross-container probes passed")]
      : [fail("Recall canary suite", failed.map((result) => result.name).join(", "))]
  };
}

async function probeContainerSearch(context, containerTag, marker) {
  const scoped = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
    q: marker,
    containerTag,
    limit: 5,
    includeFullDocs: true
  });
  const foundInContainer = scoped.ok && JSON.stringify(scoped.body).includes(marker);

  const unscoped = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
    q: marker,
    limit: 5,
    includeFullDocs: true
  });
  const unscopedFound = unscoped.ok && JSON.stringify(unscoped.body).includes(marker);

  return {
    foundInContainer,
    unscopedFound,
    detail: responseDetail(scoped)
  };
}

async function languageProbe(context, containerTag, forcedMarker) {
  const marker = forcedMarker ?? `PHYSALIS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const content = [
    "Supermemory Harness language recall probe.",
    `Deutsch: Klaus' Lieblings-Testfrucht ist die Physalis. Geheimcode ${marker}.`,
    `Hindi: Aaj ka smctl bhasha parikshan code ${marker} hai.`,
    "This document checks whether local recall can find exact multilingual content."
  ].join(" ");

  const add = await postJson(context.fetch, `${context.baseUrl}/v3/documents`, {
    content,
    containerTag,
    customId: `smctl-language-${marker}`,
    metadata: {
      source: "smctl-verify",
      smctlProbe: "language",
      marker
    }
  });
  if (!add.ok || !add.body?.id) {
    return { status: "warn", marker, detail: `language write skipped: ${responseDetail(add)}` };
  }

  const startedAt = Date.now();
  const doc = await waitForDocument(context, add.body.id, startedAt);
  if (doc.status !== "done") {
    return { status: "warn", marker, detail: `language document status ${doc.status ?? "unknown"}` };
  }

  const exact = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
    q: marker,
    containerTag,
    limit: 5,
    includeFullDocs: true
  });
  const german = await postJson(context.fetch, `${context.baseUrl}/v3/search`, {
    q: "Lieblings-Testfrucht Physalis",
    containerTag,
    limit: 5,
    includeFullDocs: true
  });

  const exactFound = exact.ok && JSON.stringify(exact.body).includes(marker);
  const germanFound = german.ok && JSON.stringify(german.body).includes(marker);
  if (exactFound && germanFound) {
    return { status: "ok", marker, detail: "exact and German recall worked" };
  }
  if (exactFound) {
    return { status: "warn", marker, detail: "exact marker worked, semantic non-English recall may be weak" };
  }
  return { status: "warn", marker, detail: "multilingual marker was not recalled; local embedding/search may need review" };
}

async function waitForDocument(context, documentId, startedAt) {
  let latest = { status: "unknown" };
  while (Date.now() - startedAt < context.timeoutMs) {
    const response = await getJson(context.fetch, `${context.baseUrl}/v3/documents/${documentId}`);
    if (response.ok) {
      latest = response.body ?? latest;
      if (["done", "failed", "error"].includes(latest.status)) {
        return latest;
      }
    }
    if (context.sleep) {
      await context.sleep(1000);
    } else {
      await sleep(1000);
    }
  }
  return { ...latest, timedOut: true };
}

function formatVerify(result) {
  const lines = [];
  lines.push("Supermemory Harness verify");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Container: ${result.containerTag}`);
  lines.push(`Marker: ${result.marker}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }

  lines.push("");
  if (result.exitCode === 0) {
    lines.push("Result: Supermemory write, recall, and project scoping are usable.");
  } else {
    lines.push("Result: Supermemory recall verification failed. Run smctl repair and smctl memory doctor.");
  }
  return lines.join("\n");
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
  if (response.status) return `HTTP ${response.status}: ${JSON.stringify(response.body)}`;
  return "No response";
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
