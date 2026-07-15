import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { analyzeMemory } from "./insights.js";

export async function runProject(options = {}) {
  const action = options.action ?? "doctor";
  if (action === "init") return projectInit(options);
  if (action === "doctor") return projectDoctor(options);
  if (action === "dashboard") return projectDashboard(options);
  throw new Error(`Unknown project action: ${action}`);
}

export async function projectInit(options = {}) {
  const context = projectContext(options);
  const profile = await detectProjectProfile(context.cwd, options);
  const path = projectProfilePath(context.home);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });

  const result = {
    command: "init",
    generatedAt: new Date().toISOString(),
    profile,
    path: redactHome(path),
    exitCode: 0
  };
  result.text = formatInit(result);
  return result;
}

export async function projectDoctor(options = {}) {
  const context = projectContext(options);
  const profile = await readProjectProfile(context.home);
  const checks = [];

  if (!profile) {
    checks.push(fail("No project profile", "Run smctl init from your project folder"));
  } else {
    checks.push(ok("Project profile installed", profile.name));
    checks.push(ok("Container tag", profile.containerTag));
    checks.push(profile.root ? ok("Project root", profile.root) : fail("Project root missing"));
  }

  const summary = summarize(checks);
  const result = {
    command: "project doctor",
    generatedAt: new Date().toISOString(),
    profile,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatDoctor(result);
  return result;
}

export async function projectDashboard(options = {}) {
  const analysis = await analyzeMemory(options);
  const profile = analysis.profile;
  const projectDocs = profile?.containerTag
    ? analysis.topContainers.find((item) => item.containerTag === profile.containerTag)?.count ?? 0
    : 0;
  const result = {
    command: "project",
    generatedAt: analysis.generatedAt,
    baseUrl: analysis.baseUrl,
    profile,
    score: analysis.score,
    sampled: analysis.documents.sampled,
    projectDocs,
    topContainers: analysis.topContainers,
    missingProject: analysis.quality.missingProject.slice(0, 8),
    next: projectNext(analysis),
    exitCode: profile ? 0 : 1
  };
  result.text = formatDashboard(result);
  return result;
}

export async function readProjectProfile(home = homedir()) {
  const path = projectProfilePath(home);
  if (!await exists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export function applyProjectToRequest(profile, request) {
  if (!profile) {
    return { metadata: {}, containerTag: null };
  }
  const requestedContainerTag = request.body?.containerTag;

  return {
    containerTag: profile.containerTag,
    metadata: {
      smctlProject: profile.name,
      smctlProjectRoot: profile.root,
      smctlProjectId: profile.id,
      smctlOriginalContainerTag: requestedContainerTag && requestedContainerTag !== profile.containerTag
        ? requestedContainerTag
        : undefined,
      smctlGitRemote: profile.gitRemote ?? undefined,
      smctlPackageName: profile.packageName ?? undefined
    }
  };
}

async function detectProjectProfile(cwd, options) {
  const root = await findProjectRoot(cwd);
  const packageJson = await readJsonIfExists(join(root, "package.json"));
  const pyproject = await readTextIfExists(join(root, "pyproject.toml"));
  const gitRemote = await readGitRemote(root);
  const packageName = packageJson?.name ?? parsePyprojectName(pyproject);
  const name = options.name ?? packageName ?? basename(root);
  const id = slugify(gitRemote ? gitRemote.replace(/\.git$/, "") : `${name}-${root}`);

  return {
    version: 1,
    id,
    name,
    root,
    packageName: packageName ?? null,
    gitRemote: gitRemote ?? null,
    skillset: options.skillset ?? "developer",
    containerTag: options.containerTag ?? `project:${slugify(name)}`,
    createdAt: new Date().toISOString()
  };
}

async function findProjectRoot(cwd) {
  let current = cwd;
  while (true) {
    if (await exists(join(current, ".git"))) return current;
    if (await exists(join(current, "package.json"))) return current;
    if (await exists(join(current, "pyproject.toml"))) return current;
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

async function readGitRemote(root) {
  const config = await readTextIfExists(join(root, ".git", "config"));
  if (!config) return null;
  const lines = config.split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[remote ")) {
      inOrigin = trimmed === `[remote "origin"]`;
      continue;
    }
    if (inOrigin && trimmed.startsWith("url = ")) {
      return trimmed.slice("url = ".length).trim();
    }
  }
  return null;
}

async function readJsonIfExists(path) {
  const text = await readTextIfExists(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readTextIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parsePyprojectName(text) {
  if (!text) return null;
  const match = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  return match?.[1] ?? null;
}

function projectContext(options) {
  return {
    home: options.home ?? homedir(),
    cwd: options.cwd ?? process.cwd()
  };
}

function projectProfilePath(home) {
  return join(home, ".config", "smctl", "projects", "active.json");
}

function formatInit(result) {
  return [
    "Supermemory Harness init",
    `Project: ${result.profile.name}`,
    `Root: ${result.profile.root}`,
    `Container: ${result.profile.containerTag}`,
    `Profile: ${result.path}`,
    "",
    "Guard will tag future Supermemory writes with this project context."
  ].join("\n");
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness project doctor");
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${check.status === "ok" ? "[ok]" : "[fail]"} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  return lines.join("\n");
}

function formatDashboard(result) {
  const lines = [];
  lines.push("Supermemory Harness project");
  lines.push(`Base URL: ${result.baseUrl}`);
  lines.push(`Memory score: ${result.score.value}/100 (${result.score.label})`);
  lines.push("");

  if (!result.profile) {
    lines.push("[warn] No active project profile");
    lines.push("   Run smctl init from the project folder.");
  } else {
    lines.push("[ok] Active project");
    lines.push(`   ${result.profile.name}`);
    lines.push("[ok] Project container");
    lines.push(`   ${result.profile.containerTag}`);
    lines.push("[ok] Project root");
    lines.push(`   ${result.profile.root}`);
    lines.push("[ok] Project memories in sample");
    lines.push(`   ${result.projectDocs} of ${result.sampled}`);
  }

  if (result.topContainers.length > 0) {
    lines.push("");
    lines.push("Containers:");
    for (const item of result.topContainers.slice(0, 5)) {
      lines.push(`   ${item.containerTag}  ${item.count}`);
    }
  }

  if (result.missingProject.length > 0) {
    lines.push("");
    lines.push("Missing project context:");
    for (const item of result.missingProject.slice(0, 5)) {
      lines.push(`   ${item.id}  ${item.title}`);
    }
  }

  lines.push("");
  lines.push(`Recommended: ${result.next[0]}`);
  lines.push("");
  lines.push(result.exitCode === 0
    ? "Result: project memory dashboard is ready."
    : "Result: project profile is missing.");
  return lines.join("\n");
}

function projectNext(analysis) {
  if (!analysis.profile) return ["smctl init"];
  if (analysis.quality.missingProject.length > 0) return ["smctl start"];
  if (analysis.score.value < 70) return ["smctl score"];
  return ["smctl verify"];
}

function summarize(checks) {
  return checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] ?? 0) + 1;
    return acc;
  }, { ok: 0, fail: 0 });
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
}

function redactHome(path) {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
