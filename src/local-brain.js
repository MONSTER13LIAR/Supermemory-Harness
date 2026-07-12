const DEFAULT_MODEL = "llama3.2:1b-instruct-q4_K_M";
const DEFAULT_BASE_URL = "http://localhost:11434";

export async function explainHarnessResult(result, options = {}) {
  const context = {
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: normalizeBaseUrl(options.ollamaUrl ?? DEFAULT_BASE_URL),
    model: options.ollamaModel ?? DEFAULT_MODEL,
    timeoutMs: options.timeoutMs ?? 60000
  };

  if (!context.fetch) {
    return fallback(result, context.model, "Fetch API unavailable; Node 22+ is required");
  }

  const prompt = buildPrompt(result);
  const response = await postJson(context.fetch, `${context.baseUrl}/api/generate`, {
    model: context.model,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      num_predict: 70,
      num_ctx: 512,
      top_p: 0.8
    }
  }, context.timeoutMs);

  if (!response.ok) {
    return fallback(result, context.model, response.error ?? `HTTP ${response.status}`);
  }

  const text = sanitize(response.body?.response);
  if (!text || refusalLike(text) || !structuredEnough(text) || contradictsResult(text, result)) {
    return fallback(result, context.model, "Local Llama returned unstructured text");
  }

  return {
    available: true,
    provider: "ollama",
    model: context.model,
    text
  };
}

export async function localBrainDoctor(options = {}) {
  const context = {
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: normalizeBaseUrl(options.ollamaUrl ?? DEFAULT_BASE_URL),
    model: options.ollamaModel ?? DEFAULT_MODEL,
    timeoutMs: options.timeoutMs ?? 5000
  };

  const tags = await getJson(context.fetch, `${context.baseUrl}/api/tags`, context.timeoutMs);
  if (!tags.ok) {
    const result = {
      command: "brain doctor",
      available: false,
      model: context.model,
      checks: [fail("Ollama server unavailable", tags.error ?? `HTTP ${tags.status}`)],
      exitCode: 1
    };
    result.text = formatDoctor(result);
    return result;
  }

  const models = Array.isArray(tags.body?.models) ? tags.body.models : [];
  const installed = models.some((model) => model.name === context.model || model.model === context.model);
  const result = {
    command: "brain doctor",
    available: installed,
    model: context.model,
    models: models.map((model) => model.name ?? model.model).filter(Boolean),
    checks: [
      ok("Ollama server reachable", context.baseUrl),
      installed
        ? ok("Local Llama model installed", context.model)
        : fail("Local Llama model missing", `Run ollama pull ${context.model}`)
    ],
    exitCode: installed ? 0 : 1
  };
  result.text = formatDoctor(result);
  return result;
}

export function appendExplanation(text, explanation) {
  if (!explanation?.available) {
    return [
      text,
      "",
      "Plain English:",
      `   Local Llama explanation unavailable: ${explanation?.detail ?? "unknown error"}`
    ].join("\n");
  }
  return [
    text,
    "",
    "Plain English:",
    ...explanation.text.split(/\r?\n/).filter(Boolean).map((line) => `   ${line}`)
  ].join("\n");
}

function buildPrompt(result) {
  const compact = compactResult(result);
  return [
    "Explain this smctl result to a non-technical user.",
    "Return exactly 3 lines, no intro:",
    "Works: ...",
    "Needs attention: ...",
    "Next: ...",
    "If exitCode is non-zero or any fail exists, Needs attention must mention the failure.",
    "Use only these commands: smctl repair wizard, smctl repair, smctl verify, smctl score, smctl cleanup, smctl memory coach, smctl memory doctor, smctl memory replay.",
    compactToLines(compact)
  ].join("\n");
}

function compactResult(result) {
  return {
    command: result.command,
    summary: result.summary,
    exitCode: result.exitCode,
    baseUrl: result.baseUrl,
    checks: result.checks?.map((check) => ({
      status: check.status,
      title: check.title,
      detail: check.detail
    })),
    sections: result.sections?.map((section) => ({
      status: section.status,
      title: section.title,
      detail: section.detail
    })),
    next: result.next,
    actions: result.actions?.map((action) => ({
      title: action.title,
      detail: action.detail
    })),
    documents: result.documents ? {
      sampled: result.documents.sampled,
      failed: result.documents.failed?.length,
      queued: result.documents.queued?.length,
      stale: result.documents.stale?.length
    } : undefined,
    storage: result.storage,
    language: result.language
  };
}

function compactToLines(result) {
  const lines = [];
  lines.push(`command: ${result.command}`);
  lines.push(`summary: ${JSON.stringify(result.summary ?? {})}`);
  if (result.exitCode !== undefined) lines.push(`exitCode: ${result.exitCode}`);
  for (const item of result.sections ?? []) {
    lines.push(`${item.status}: ${item.title} - ${item.detail ?? ""}`);
  }
  for (const item of result.checks ?? []) {
    lines.push(`${item.status}: ${item.title} - ${item.detail ?? ""}`);
  }
  if (Array.isArray(result.next) && result.next.length > 0) {
    lines.push(`next: ${result.next.join(", ")}`);
  }
  for (const action of result.actions ?? []) {
    lines.push(`action: ${action.title} - ${action.detail}`);
  }
  if (result.documents) {
    lines.push(`documents: sampled ${result.documents.sampled}, failed ${result.documents.failed ?? 0}, queued ${result.documents.queued ?? 0}, stale ${result.documents.stale ?? 0}`);
  }
  if (result.storage?.bytes !== undefined) {
    lines.push(`storage: ${result.storage.bytes} bytes, risk ${result.storage.risk}`);
  }
  if (result.language?.detail) {
    lines.push(`language: ${result.language.detail}`);
  }
  return lines.slice(0, 24).join("\n");
}

async function postJson(fetchFn, url, body, timeoutMs) {
  return requestJson(fetchFn, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }, timeoutMs);
}

async function getJson(fetchFn, url, timeoutMs) {
  return requestJson(fetchFn, url, { method: "GET" }, timeoutMs);
}

async function requestJson(fetchFn, url, init, timeoutMs) {
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
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
      error: formatFetchError(error)
    };
  }
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness local brain");
  lines.push(`Model: ${result.model}`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${check.status === "ok" ? "[ok]" : "[fail]"} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: Local Llama is ready for Harness explanations."
    : "Result: Local Llama is not ready yet.");
  return lines.join("\n");
}

function sanitize(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}

function refusalLike(text) {
  return /can't help|cannot help|i can’t|i cannot|policy/i.test(text);
}

function structuredEnough(text) {
  return /Works:/i.test(text) && /Needs attention:/i.test(text) && /Next:/i.test(text);
}

function fallbackExplanation(result) {
  const items = [...(result.sections ?? []), ...(result.checks ?? []), ...(result.issues ?? [])];
  const works = items
    .filter((item) => item.status === "ok")
    .map((item) => item.title)
    .slice(0, 3);
  const needs = items
    .filter((item) => item.status !== "ok")
    .map((item) => item.detail ? `${item.title} (${item.detail})` : item.title)
    .slice(0, 3);
  const next = result.next?.includes("smctl repair wizard")
    ? "smctl repair wizard"
    : result.next?.includes("smctl repair")
      ? "smctl repair"
      : result.next?.[0] ?? nextCommandFor(result);

  return [
    `Works: ${works.length > 0 ? works.join(", ") : "Harness could read the result."}`,
    `Needs attention: ${needs.length > 0 ? needs.join("; ") : "Nothing urgent was found."}`,
    `Next: run ${next}.`
  ].join("\n");
}

function contradictsResult(text, result) {
  const hasFailure = result.exitCode > 0
    || result.summary?.fail > 0
    || result.issues?.some((issue) => issue.status === "fail")
    || result.checks?.some((check) => check.status === "fail")
    || result.sections?.some((section) => section.status === "fail");
  if (!hasFailure) return false;
  return /nothing urgent|no issue|no problem|looks good|all good/i.test(text);
}

function nextCommandFor(result) {
  if (result.command === "repair wizard") return "smctl memory replay";
  if (result.command === "repair") return "smctl memory doctor";
  if (result.command === "verify") return "smctl repair";
  return "smctl status";
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

function unavailable(detail) {
  return {
    available: false,
    provider: "ollama",
    model: DEFAULT_MODEL,
    detail
  };
}

function fallback(result, model, detail) {
  return {
    available: true,
    provider: "local-fallback",
    model,
    detail,
    text: fallbackExplanation(result)
  };
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
