import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHECK = "ok";
const WARN = "warn";
const FAIL = "fail";
const INFO = "info";

const ROUTES_TO_REPORT = [
  "/v3/documents",
  "/v3/documents/list",
  "/v3/search",
  "/v4/conversations",
  "/v4/memories",
  "/v4/search"
];

export async function runDoctor(options = {}) {
  const context = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? "http://localhost:6767"),
    cwd: options.cwd ?? process.cwd(),
    home: options.home ?? homedir(),
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch
  };

  const checks = [];
  const homeStore = join(context.home, ".supermemory");
  const projectStore = join(context.cwd, ".supermemory");

  const install = await inspectInstall(context, homeStore);
  checks.push(...install.checks);

  const stores = await inspectStores(homeStore, projectStore);
  checks.push(...stores.checks);

  const key = await inspectApiKey(homeStore);
  checks.push(...key.checks);

  const server = await inspectServer(context, homeStore);
  checks.push(...server.checks);

  const tools = await inspectToolIntegrations(context);
  checks.push(...tools.checks);

  const summary = summarize(checks);
  const result = {
    command: "doctor",
    generatedAt: new Date().toISOString(),
    baseUrl: context.baseUrl,
    summary,
    install: install.data,
    stores: stores.data,
    apiKey: key.data,
    server: server.data,
    tools: tools.data,
    checks,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatDoctor(result);
  return result;
}

async function inspectInstall(context, homeStore) {
  const checks = [];
  const data = {
    expectedHomeStore: homeStore,
    binary: null,
    pathWrapper: null,
    version: null
  };

  const binaryPath = join(homeStore, "bin", "supermemory-server");
  if (await exists(binaryPath)) {
    data.binary = binaryPath;
    checks.push(ok("Supermemory server binary exists", binaryPath));
  } else {
    checks.push(fail("Supermemory server binary missing", binaryPath));
  }

  const wrapper = await which("supermemory-server", context.env);
  if (wrapper) {
    data.pathWrapper = wrapper;
    checks.push(ok("supermemory-server is on PATH", wrapper));
  } else {
    checks.push(warn("supermemory-server is not on PATH", "Expected wrapper such as ~/.local/bin/supermemory-server"));
  }

  const versionFile = join(homeStore, "bin", "supermemory-server.version");
  if (await exists(versionFile)) {
    data.version = (await readFile(versionFile, "utf8")).trim();
    checks.push(ok("Installed Supermemory Local version detected", data.version));
  } else {
    checks.push(warn("Installed version file not found", versionFile));
  }

  return { checks, data };
}

async function inspectStores(homeStore, projectStore) {
  const checks = [];
  const homeExists = await exists(homeStore);
  const projectExists = await exists(projectStore);
  const data = {
    homeStore: { path: homeStore, exists: homeExists },
    projectStore: { path: projectStore, exists: projectExists }
  };

  if (homeExists) {
    checks.push(ok("Home Supermemory store exists", redactHome(homeStore)));
  } else {
    checks.push(fail("Home Supermemory store missing", redactHome(homeStore)));
  }

  if (await exists(join(homeStore, "data"))) {
    checks.push(ok("Home store data file exists", "~/.supermemory/data"));
  } else {
    checks.push(warn("Home store data file missing", "~/.supermemory/data"));
  }

  if (await exists(join(homeStore, "runtime"))) {
    checks.push(ok("Home runtime directory exists", "~/.supermemory/runtime"));
  } else {
    checks.push(warn("Home runtime directory missing", "~/.supermemory/runtime"));
  }

  if (projectExists && homeExists) {
    checks.push(warn("Both home and project-local Supermemory stores exist", "Start the server from $HOME unless you intentionally want a project-local store"));
  } else if (projectExists) {
    checks.push(warn("Project-local Supermemory store exists", redactHome(projectStore)));
  } else {
    checks.push(ok("No project-local Supermemory store found", redactHome(projectStore)));
  }

  return { checks, data };
}

async function inspectApiKey(homeStore) {
  const checks = [];
  const apiKeyPath = join(homeStore, "api-key");
  const authSecretPath = join(homeStore, "auth-secret");
  const envEncPath = join(homeStore, "env.enc");
  const data = {
    apiKeyFile: { path: "~/.supermemory/api-key", exists: false, shape: "unknown" },
    authSecretFile: { path: "~/.supermemory/auth-secret", exists: false },
    encryptedEnvFile: { path: "~/.supermemory/env.enc", exists: false }
  };

  if (await exists(apiKeyPath)) {
    data.apiKeyFile.exists = true;
    const key = (await readFile(apiKeyPath, "utf8")).trim();
    const sane = key.startsWith("sm_") && key.length >= 80;
    data.apiKeyFile.shape = sane ? "looks-valid" : "unexpected";
    checks.push(sane
      ? ok("API key file exists with sane shape", "prefix sm_, length redacted")
      : warn("API key file exists but shape is unexpected", "value redacted"));
  } else {
    checks.push(fail("API key file missing", "~/.supermemory/api-key"));
  }

  data.authSecretFile.exists = await exists(authSecretPath);
  checks.push(data.authSecretFile.exists
    ? ok("Auth secret file exists", "~/.supermemory/auth-secret")
    : warn("Auth secret file missing", "~/.supermemory/auth-secret"));

  data.encryptedEnvFile.exists = await exists(envEncPath);
  checks.push(data.encryptedEnvFile.exists
    ? ok("Encrypted env file exists", "~/.supermemory/env.enc")
    : warn("Encrypted env file missing", "~/.supermemory/env.enc"));

  checks.push(info("Localhost auth note", "localhost may auto-apply the API key; doctor reports key file shape and API reachability separately"));
  return { checks, data };
}

async function inspectServer(context, homeStore) {
  const checks = [];
  const data = {
    reachable: false,
    dashboardStatus: null,
    openApiStatus: null,
    routes: {},
    lastStartupError: null
  };

  if (!context.fetch) {
    checks.push(warn("Fetch API unavailable", "Node 22+ should provide global fetch"));
    return { checks, data };
  }

  const root = await request(context.fetch, `${context.baseUrl}/`, { method: "GET" });
  data.dashboardStatus = root.status;
  if (root.ok) {
    data.reachable = true;
    checks.push(ok("Supermemory Local dashboard is reachable", `${context.baseUrl}/ returned ${root.status}`));
  } else if (root.error) {
    checks.push(fail("Supermemory Local is not reachable", root.error));
    data.lastStartupError = await latestStartupError(join(homeStore, "error.log"));
    if (data.lastStartupError) {
      checks.push(warn("Latest Supermemory startup error", data.lastStartupError));
    }
  } else {
    checks.push(fail("Supermemory Local dashboard returned unexpected status", String(root.status)));
  }

  const openApi = await request(context.fetch, `${context.baseUrl}/v4/openapi`, { method: "GET" });
  data.openApiStatus = openApi.status;
  if (openApi.ok) {
    const json = await safeJson(openApi.response);
    const paths = json?.paths ? Object.keys(json.paths) : [];
    data.openApiPathCount = paths.length;
    checks.push(ok("OpenAPI document is reachable", `/v4/openapi returned ${openApi.status}`));
    for (const route of ROUTES_TO_REPORT) {
      data.routes[route] = paths.includes(route) ? "present" : "not-listed";
    }
  } else if (openApi.error) {
    checks.push(warn("OpenAPI document is not reachable", openApi.error));
  } else {
    checks.push(warn("OpenAPI document returned unexpected status", String(openApi.status)));
  }

  for (const route of ROUTES_TO_REPORT) {
    const state = data.routes[route];
    if (state === "present") {
      checks.push(ok(`Route listed: ${route}`, "from /v4/openapi"));
    } else if (state === "not-listed") {
      checks.push(warn(`Route not listed: ${route}`, "from /v4/openapi"));
    } else {
      checks.push(info(`Route not checked: ${route}`, "OpenAPI unavailable"));
    }
  }

  return { checks, data };
}

async function inspectToolIntegrations(context) {
  const checks = [];
  const home = context.home;
  const toolSpecs = [
    {
      name: "Claude Code",
      command: "claude",
      files: [
        join(home, ".claude", "settings.json"),
        join(home, ".claude", "settings.local.json"),
        join(home, ".claude.json")
      ],
      requiredEnv: ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_CC_API_KEY"],
      matcher: (content) => hasAll(content, ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_CC_API_KEY"])
    },
    {
      name: "Codex",
      command: "codex",
      files: [join(home, ".codex", "config.toml")],
      requiredEnv: ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_CODEX_API_KEY"],
      matcher: (content) => hasAll(content, ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_CODEX_API_KEY"])
    },
    {
      name: "OpenCode",
      command: "opencode",
      files: [
        join(home, ".config", "opencode", "opencode.json"),
        join(home, ".opencode.json")
      ],
      requiredEnv: ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_API_KEY"],
      matcher: (content) => hasAll(content, ["SUPERMEMORY_BASE_URL", "SUPERMEMORY_API_KEY"])
    },
    {
      name: "Cursor",
      command: "cursor",
      files: [join(home, ".cursor", "mcp.json")],
      requiredEnv: [],
      matcher: (content) => content.includes("localhost:6767/mcp") || content.includes("127.0.0.1:6767/mcp")
    }
  ];

  const data = {};
  for (const spec of toolSpecs) {
    const commandPath = await which(spec.command, context.env);
    const files = [];
    let configured = false;
    for (const file of spec.files) {
      const fileExists = await exists(file);
      const record = { path: redactHome(file), exists: fileExists, matches: false };
      if (fileExists) {
        const content = await readFile(file, "utf8");
        record.matches = spec.matcher(content);
        configured = configured || record.matches;
      }
      files.push(record);
    }

    data[spec.name] = {
      command: spec.command,
      installed: Boolean(commandPath),
      commandPath,
      configured,
      files,
      requiredEnv: spec.requiredEnv
    };

    checks.push(commandPath
      ? ok(`${spec.name} is installed`, commandPath)
      : info(`${spec.name} is not on PATH`, spec.command));

    if (configured) {
      checks.push(ok(`${spec.name} Supermemory integration config found`, "expected env/route references present"));
    } else {
      checks.push(warn(`${spec.name} Supermemory integration config not found`, spec.files.map(redactHome).join(", ")));
    }
  }

  return { checks, data };
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness doctor");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.warn} warn, ${result.summary.fail} fail, ${result.summary.info} info`);
  lines.push("");

  for (const check of result.checks) {
    lines.push(`${symbol(check.status)} ${check.title}`);
    if (check.detail) {
      lines.push(`   ${check.detail}`);
    }
  }

  lines.push("");
  if (result.summary.fail > 0) {
    lines.push("Result: Supermemory Local needs attention before it is ready.");
  } else if (result.summary.warn > 0) {
    lines.push("Result: Supermemory Local is usable, with warnings to review.");
  } else {
    lines.push("Result: Supermemory Local looks ready.");
  }
  return lines.join("\n");
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, warn: 0, fail: 0, info: 0 });
}

function ok(title, detail) {
  return { status: CHECK, title, detail };
}

function warn(title, detail) {
  return { status: WARN, title, detail };
}

function fail(title, detail) {
  return { status: FAIL, title, detail };
}

function info(title, detail) {
  return { status: INFO, title, detail };
}

function symbol(status) {
  if (status === CHECK) return "[ok]";
  if (status === WARN) return "[warn]";
  if (status === FAIL) return "[fail]";
  return "[info]";
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function which(command, env) {
  const pathValue = env.PATH ?? "";
  const entries = pathValue.split(":").filter(Boolean);
  for (const entry of entries) {
    const candidate = join(entry, command);
    try {
      await access(candidate, constants.X_OK);
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) return candidate;
    } catch {
      // Keep searching PATH.
    }
  }

  try {
    const { stdout } = await execFileAsync("which", [command], { env });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function request(fetchFn, url, init) {
  try {
    const response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(1500)
    });
    return {
      ok: response.ok,
      status: response.status,
      response
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: formatFetchError(error)
    };
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function hasAll(content, needles) {
  return needles.every((needle) => content.includes(needle));
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function redactHome(path) {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

function formatFetchError(error) {
  const cause = error.cause;
  if (cause?.code) {
    return `${error.message}: ${cause.code}`;
  }
  return error.message;
}

async function latestStartupError(path) {
  if (!await exists(path)) return null;
  const content = await readFile(path, "utf8");
  const fatal = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("fatal during startup"))
    .at(-1);
  return fatal ?? null;
}
