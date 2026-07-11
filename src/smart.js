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
  if (action === "disable") return smartDisable(options);
  throw new Error(`Unknown smart action: ${action}`);
}

export async function smartEnable(options = {}) {
  const context = smartContext(options);
  const detected = detectProvider(context.env, options);
  if (detected?.error) {
    return smartResult({
      command: "smart enable",
      status: "failed",
      exitCode: 1,
      detail: detected.error
    });
  }
  if (!detected) {
    return smartResult({
      command: "smart enable",
      status: "failed",
      exitCode: 1,
      detail: "No supported provider API key found in environment. Export OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, or pass --api-key-env."
    });
  }

  const config = {
    enabled: true,
    provider: detected.provider,
    apiKeyRef: `env:${detected.apiKeyEnv}`,
    model: options.model ?? detected.model,
    createdAt: new Date().toISOString()
  };

  if (!options.yes) {
    return smartResult({
      command: "smart enable",
      status: "needs-confirmation",
      exitCode: 0,
      detail: `Found ${detected.apiKeyEnv}. Run smctl smart enable --yes to store a reference to it. The key will not be copied.`
    }, config);
  }

  await mkdir(dirname(context.configPath), { recursive: true });
  await writeFile(context.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(context.configPath, 0o600);

  return smartResult({
    command: "smart enable",
    status: "enabled",
    exitCode: 0,
    detail: `Smart Assist enabled with ${detected.provider}; key reference ${config.apiKeyRef}`
  }, config);
}

export async function smartDoctor(options = {}) {
  const context = smartContext(options);
  const config = await readSmartConfig(context.configPath);
  const checks = [];

  if (!config) {
    checks.push(fail("Smart Assist not enabled", "Run smctl smart enable"));
  } else {
    checks.push(ok("Smart Assist config found", configSummary(config)));
    const envName = config.apiKeyRef?.startsWith("env:") ? config.apiKeyRef.slice(4) : null;
    if (envName && context.env[envName]) {
      checks.push(ok("Referenced API key env is available", envName));
    } else if (envName) {
      checks.push(fail("Referenced API key env is missing", envName));
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

export async function smartDisable(options = {}) {
  const context = smartContext(options);
  if (await exists(context.configPath)) {
    await rm(context.configPath);
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
  return {
    home,
    env: options.env ?? process.env,
    configPath: options.configPath ?? join(home, ".config", "smctl", "smart.json")
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
