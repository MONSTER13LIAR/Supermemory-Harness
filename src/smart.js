import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const PROVIDERS = {
  openai: {
    env: "OPENAI_API_KEY",
    model: "gpt-4.1-mini"
  },
  gemini: {
    env: "GEMINI_API_KEY",
    model: "gemini-2.5-flash"
  },
  anthropic: {
    env: "ANTHROPIC_API_KEY",
    model: "claude-3-5-haiku-latest"
  }
};

const GENERIC_API_KEY_ENVS = [
  "LLM_API_KEY",
  "AI_API_KEY",
  "MODEL_API_KEY",
  "PROVIDER_API_KEY",
  "SUPERMEMORY_API_KEY"
];

export async function runSmart(options = {}) {
  const action = options.action ?? "doctor";
  if (action === "enable") return smartEnable(options);
  if (action === "doctor") return smartDoctor(options);
  if (action === "ping") return smartPing(options);
  if (action === "disable") return smartDisable(options);
  throw new Error(`Unknown smart action: ${action}`);
}

export async function smartEnable(options = {}) {
  const context = smartContext(options);
  let detected = detectProvider(context.env, options);
  if (detected?.error) {
    return smartResult({
      command: "smart enable",
      status: "failed",
      exitCode: 1,
      detail: detected.error
    });
  }
  if (!detected && options.prompt) {
    detected = await detectPromptedProvider(context, options);
    if (detected?.error) {
      return smartResult({
        command: "smart enable",
        status: "failed",
        exitCode: 1,
        detail: detected.error
      });
    }
  }
  if (!detected) {
    return smartResult({
      command: "smart enable",
      status: "failed",
      exitCode: 1,
      detail: "No supported provider API key found in environment. Export OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, pass --api-key-env, or use --prompt."
    });
  }

  const config = {
    enabled: true,
    provider: detected.provider,
    apiKeyRef: detected.apiKeyRef ?? `env:${detected.apiKeyEnv}`,
    model: options.model ?? detected.model,
    createdAt: new Date().toISOString()
  };

  if (!options.yes && !options.prompt) {
    return smartResult({
      command: "smart enable",
      status: "needs-confirmation",
      exitCode: 0,
      detail: `Found ${detected.apiKeyEnv}. Run smctl smart enable --yes to store a reference to it. The key will not be copied.`
    }, config);
  }

  await mkdir(dirname(context.configPath), { recursive: true });
  if (detected.apiKeyValue) {
    await writeFile(context.keyPath, `${detected.apiKeyValue.trim()}\n`, { mode: 0o600 });
    await chmod(context.keyPath, 0o600);
  }
  await writeFile(context.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(context.configPath, 0o600);

  return smartResult({
    command: "smart enable",
    status: "enabled",
    exitCode: 0,
    detail: detected.apiKeyValue
      ? `Smart Assist enabled with ${detected.provider}; key stored in a private local Harness secret file`
      : `Smart Assist enabled with ${detected.provider}; key reference ${config.apiKeyRef}`
  }, config);
}

export async function smartDoctor(options = {}) {
  const context = smartContext(options);
  const config = await readSmartConfig(context.configPath);
  const checks = [];

  if (!config) {
    checks.push(fail("Smart Assist not enabled", "Run smctl smart enable --prompt"));
  } else {
    checks.push(ok("Smart Assist config found", configSummary(config)));
    const ref = parseApiKeyRef(config.apiKeyRef);
    if (ref.type === "env" && context.env[ref.value]) {
      checks.push(ok("Referenced API key env is available", ref.value));
    } else if (ref.type === "env") {
      checks.push(fail("Referenced API key env is missing", ref.value));
    } else if (ref.type === "file" && await exists(ref.value)) {
      checks.push(ok("Stored API key file is present", ref.value));
    } else if (ref.type === "file") {
      checks.push(fail("Stored API key file is missing", ref.value));
    } else {
      checks.push(fail("Unsupported apiKeyRef", config.apiKeyRef ?? "missing"));
    }
  }

  if (await exists(join(context.home, ".supermemory", "env.enc"))) {
    checks.push(info("Supermemory encrypted env present", "Harness does not decrypt env.enc; use exported env vars for Smart Assist"));
  }

  const summary = summarize(checks);
  const result = {
    command: "smart doctor",
    generatedAt: new Date().toISOString(),
    enabled: Boolean(config?.enabled),
    config: config ? redactConfig(config) : null,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatDoctor(result);
  return result;
}

export async function smartPing(options = {}) {
  const context = smartContext(options);
  const config = await readSmartConfig(context.configPath);
  if (!config?.enabled) {
    return smartResult({
      command: "smart ping",
      status: "failed",
      exitCode: 1,
      detail: "Smart Assist is not enabled. Run smctl smart enable --prompt first."
    });
  }

  const keyInfo = await resolveApiKeyRef(config.apiKeyRef, context.env);
  if (keyInfo.error) {
    return smartResult({
      command: "smart ping",
      status: "failed",
      exitCode: 1,
      detail: keyInfo.error
    }, config);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return smartResult({
      command: "smart ping",
      status: "failed",
      exitCode: 1,
      detail: "No fetch implementation available in this Node runtime."
    }, config);
  }

  const startedAt = Date.now();
  const ping = await pingProvider({
    provider: config.provider,
    model: config.model,
    apiKey: keyInfo.value,
    fetch: fetchImpl,
    timeoutMs: options.timeoutMs ?? 20000
  });
  const latencyMs = Date.now() - startedAt;

  if (!ping.ok) {
    return smartResult({
      command: "smart ping",
      status: "failed",
      exitCode: 1,
      detail: `${ping.message} (${latencyMs}ms)`
    }, config);
  }

  return smartResult({
    command: "smart ping",
    status: "ok",
    exitCode: 0,
    detail: `Provider responded with ${ping.reply} (${latencyMs}ms)`
  }, config);
}

export async function smartDisable(options = {}) {
  const context = smartContext(options);
  if (await exists(context.configPath)) {
    await rm(context.configPath);
  }
  if (await exists(context.keyPath)) {
    await rm(context.keyPath);
  }
  return smartResult({
    command: "smart disable",
    status: "disabled",
    exitCode: 0,
    detail: "Smart Assist disabled"
  });
}

export async function readSmartConfig(path = smartContext({}).configPath) {
  if (!await exists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

function detectProvider(env, options) {
  if (options.provider && !PROVIDERS[options.provider]) {
    throw new Error(`Unsupported smart provider: ${options.provider}`);
  }

  if (options.apiKeyEnv) {
    return detectProviderForEnvName(env, options.apiKeyEnv, options.provider);
  }

  if (options.provider) {
    const defaults = PROVIDERS[options.provider];
    if (env[defaults.env]) {
      return {
        provider: options.provider,
        apiKeyEnv: defaults.env,
        model: defaults.model
      };
    }
    return null;
  }

  for (const [provider, defaults] of Object.entries(PROVIDERS)) {
    if (env[defaults.env]) {
      return {
        provider,
        apiKeyEnv: defaults.env,
        model: defaults.model
      };
    }
  }

  for (const apiKeyEnv of GENERIC_API_KEY_ENVS) {
    const detected = detectProviderForEnvName(env, apiKeyEnv);
    if (detected) return detected;
  }

  const inferred = Object.keys(env)
    .filter((name) => name.endsWith("_API_KEY") || name === "API_KEY")
    .map((name) => detectProviderForEnvName(env, name, null, { ignoreUnknown: true }))
    .filter(Boolean);

  const unique = uniqueDetections(inferred);
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    return {
      error: `Multiple provider-shaped API keys found (${unique.map((item) => item.apiKeyEnv).join(", ")}). Re-run with --api-key-env <name>.`
    };
  }
  return null;
}

function detectProviderForEnvName(env, apiKeyEnv, explicitProvider = null, options = {}) {
  const value = env[apiKeyEnv];
  if (!value) return null;

  if (explicitProvider) {
    return {
      provider: explicitProvider,
      apiKeyEnv,
      model: PROVIDERS[explicitProvider].model
    };
  }

  const provider = inferProviderFromKey(value);
  if (!provider) {
    if (options.ignoreUnknown) return null;
    return {
      error: `Found ${apiKeyEnv}, but could not infer whether it is OpenAI, Gemini, or Anthropic. Re-run with --provider <openai|gemini|anthropic>.`
    };
  }

  return {
    provider,
    apiKeyEnv,
    model: PROVIDERS[provider].model
  };
}

async function detectPromptedProvider(context, options) {
  const apiKey = await readPromptedApiKey(options);
  if (!apiKey?.trim()) {
    return { error: "No API key was entered." };
  }

  if (options.provider) {
    return {
      provider: options.provider,
      apiKeyRef: `file:${context.keyPath}`,
      apiKeyValue: apiKey,
      model: PROVIDERS[options.provider].model
    };
  }

  const provider = inferProviderFromKey(apiKey);
  if (!provider) {
    const selectedProvider = await chooseProvider(options);
    if (!selectedProvider) {
      return {
        error: "Could not infer whether the pasted key is OpenAI, Gemini, or Anthropic."
      };
    }
    return {
      provider: selectedProvider,
      apiKeyRef: `file:${context.keyPath}`,
      apiKeyValue: apiKey,
      model: PROVIDERS[selectedProvider].model
    };
  }

  await notifyDetectedProvider(provider, options);
  return {
    provider,
    apiKeyRef: `file:${context.keyPath}`,
    apiKeyValue: apiKey,
    model: PROVIDERS[provider].model
  };
}

async function readPromptedApiKey(options) {
  if (options.promptApiKey) return options.promptApiKey();
  return promptHidden("Provider API key: ");
}

async function chooseProvider(options) {
  if (options.chooseProvider) return options.chooseProvider();
  return promptProviderChoice();
}

async function notifyDetectedProvider(provider, options) {
  if (options.onProviderDetected) {
    await options.onProviderDetected(provider);
    return;
  }
  if (process.stderr?.isTTY) {
    process.stderr.write(`Detected provider: ${provider}\n`);
  }
}

function inferProviderFromKey(value) {
  const key = String(value).trim();
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith(`sk-${"ant"}-`)) return "anthropic";
  if (key.startsWith("sk-") || key.startsWith("sess-")) return "openai";
  return null;
}

function uniqueDetections(detections) {
  const seen = new Set();
  const unique = [];
  for (const detection of detections) {
    if (detection.error) return [detection];
    const key = `${detection.provider}:${detection.apiKeyEnv}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(detection);
    }
  }
  return unique;
}

async function resolveApiKeyRef(apiKeyRef, env) {
  const ref = parseApiKeyRef(apiKeyRef);
  if (ref.type === "env") {
    const value = env[ref.value];
    if (!value) {
      return { error: `Referenced API key env is missing: ${ref.value}` };
    }
    return { envName: ref.value, value };
  }
  if (ref.type === "file") {
    try {
      const value = (await readFile(ref.value, "utf8")).trim();
      if (!value) return { error: "Stored API key file is empty" };
      return { filePath: ref.value, value };
    } catch {
      return { error: `Stored API key file is missing: ${ref.value}` };
    }
  }
  return { error: `Unsupported apiKeyRef ${apiKeyRef ?? "missing"}` };
}

function parseApiKeyRef(apiKeyRef) {
  if (apiKeyRef?.startsWith("env:")) {
    return { type: "env", value: apiKeyRef.slice(4) };
  }
  if (apiKeyRef?.startsWith("file:")) {
    return { type: "file", value: apiKeyRef.slice(5) };
  }
  return { type: "unsupported", value: apiKeyRef };
}

async function promptHidden(question) {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Interactive key prompt requires a TTY. Use an env var or run this command in a terminal.");
  }

  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.setRawMode(false);
      input.off("data", onData);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Prompt cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    input.on("data", onData);
  });
}

async function promptProviderChoice() {
  const input = process.stdin;
  const output = process.stderr;
  if (!input.isTTY || !output.isTTY) return null;

  output.write("Could not infer provider from key shape.\n");
  output.write("Choose provider: [1] OpenAI  [2] Gemini  [3] Anthropic: ");
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve) => {
    const onData = (chunk) => {
      input.off("data", onData);
      input.pause();
      output.write("\n");
      const answer = String(chunk).trim().toLowerCase();
      if (answer === "1" || answer === "openai") resolve("openai");
      else if (answer === "2" || answer === "gemini") resolve("gemini");
      else if (answer === "3" || answer === "anthropic") resolve("anthropic");
      else resolve(null);
    };
    input.on("data", onData);
  });
}

async function pingProvider({ provider, model, apiKey, fetch, timeoutMs }) {
  if (provider === "openai") {
    return pingOpenAI({ model, apiKey, fetch, timeoutMs });
  }
  if (provider === "gemini") {
    return pingGemini({ model, apiKey, fetch, timeoutMs });
  }
  if (provider === "anthropic") {
    return pingAnthropic({ model, apiKey, fetch, timeoutMs });
  }
  return { ok: false, message: `Unsupported smart provider: ${provider}` };
}

async function pingOpenAI({ model, apiKey, fetch, timeoutMs }) {
  const response = await fetchJson(fetch, "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: "Reply exactly: smctl-ok",
      max_output_tokens: 16
    })
  }, timeoutMs);
  if (!response.ok) return response;
  const reply = response.data.output_text ?? response.data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("").trim();
  return normalizePingReply(reply);
}

async function pingGemini({ model, apiKey, fetch, timeoutMs }) {
  const response = await fetchJson(fetch, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply exactly: smctl-ok" }] }],
      generationConfig: { maxOutputTokens: 16 }
    })
  }, timeoutMs);
  if (!response.ok) return response;
  const reply = response.data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  return normalizePingReply(reply);
}

async function pingAnthropic({ model, apiKey, fetch, timeoutMs }) {
  const response = await fetchJson(fetch, "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply exactly: smctl-ok" }]
    })
  }, timeoutMs);
  if (!response.ok) return response;
  const reply = response.data.content?.map((item) => item.text ?? "").join("").trim();
  return normalizePingReply(reply);
}

async function fetchJson(fetch, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const data = text ? safeJson(text) : {};
    if (!response.ok) {
      return {
        ok: false,
        message: `${response.status} ${response.statusText || "provider error"}: ${providerErrorMessage(data)}`
      };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error.name === "AbortError" ? "Provider ping timed out" : `Provider ping failed: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function providerErrorMessage(data) {
  const message = data?.error?.message ?? data?.error?.status ?? data?.message;
  return message ? sanitizeProviderMessage(message) : "request failed";
}

function sanitizeProviderMessage(message) {
  return String(message)
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-key]");
}

function normalizePingReply(reply) {
  const normalized = String(reply ?? "").trim();
  if (!normalized) return { ok: false, message: "Provider returned an empty response" };
  return { ok: true, reply: normalized.slice(0, 80) };
}

function smartResult(base, config = null) {
  const result = {
    ...base,
    generatedAt: new Date().toISOString(),
    config: config ? redactConfig(config) : null
  };
  result.text = [
    `Supermemory Harness ${base.command}`,
    `Status: ${base.status}`,
    base.detail,
    config ? `Provider: ${config.provider}` : null,
    config ? `Model: ${config.model}` : null,
    config ? `API key: ${config.apiKeyRef}` : null
  ].filter(Boolean).join("\n");
  return result;
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness smart doctor");
  lines.push(`Enabled: ${result.enabled ? "yes" : "no"}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.fail} fail, ${result.summary.info} info`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  return lines.join("\n");
}

function smartContext(options = {}) {
  const home = options.home ?? homedir();
  const configDir = join(home, ".config", "smctl");
  return {
    home,
    env: options.env ?? process.env,
    configPath: options.configPath ?? join(configDir, "smart.json"),
    keyPath: options.keyPath ?? join(configDir, "smart.key")
  };
}

function redactConfig(config) {
  return {
    enabled: Boolean(config.enabled),
    provider: config.provider,
    apiKeyRef: config.apiKeyRef,
    model: config.model
  };
}

function configSummary(config) {
  const redacted = redactConfig(config);
  return `${redacted.provider} ${redacted.model} using ${redacted.apiKeyRef}`;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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
