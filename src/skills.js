import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const AGENT_SKILLS = {
  "memory-write-hygiene": {
    title: "Memory Write Hygiene",
    filename: "memory-write-hygiene.md",
    body: `# Memory Write Hygiene

Use this skill before writing to Supermemory.

## Rules

- Search for related existing memories before writing a new one.
- Do not write secrets, credentials, private keys, tokens, passwords, or raw environment values.
- Prefer durable decisions, user preferences, project conventions, stable facts, and unresolved work.
- Avoid saving logs, stack traces, package install output, transient errors, and duplicated notes.
- Use the active project container tag when present.
- Add consistent metadata for memory type, project, tool, domain, and source when available.

## Write Checklist

1. Is this memory useful beyond the current turn?
2. Is it already represented by an existing memory?
3. Is it free of secrets and sensitive raw data?
4. Does it belong to the active project/container?
5. Can it be summarized into one clear durable statement?
`
  },
  "memory-query-patterns": {
    title: "Memory Query Patterns",
    filename: "memory-query-patterns.md",
    body: `# Memory Query Patterns

Use this skill before assuming project or user context.

## Rules

- Query Supermemory before asking the user to repeat stable context.
- Query before making project-wide claims about preferences, architecture, conventions, or previous decisions.
- Use focused searches instead of broad vague searches.
- Prefer project-scoped searches when a project container tag is available.
- If retrieved memories conflict, surface the conflict instead of silently choosing one.

## Good Query Shapes

- "project architecture decision database migrations"
- "user preference testing framework"
- "deployment convention environment variables"
- "open issue memory replay failed documents"

## When To Ask The User

Ask the user only when Supermemory has no relevant memory, memories conflict, or the action has real risk.
`
  },
  "context-injection-format": {
    title: "Context Injection Format",
    filename: "context-injection-format.md",
    body: `# Context Injection Format

Use this skill when Supermemory returns memories for a session.

## Rules

- Do not dump raw JSON into reasoning or user-facing answers.
- Convert retrieved memories into a short context brief.
- Keep source memory IDs or titles available for traceability when possible.
- Separate facts, preferences, decisions, and open questions.
- Treat retrieved memory as context, not absolute truth.

## Recommended Format

### Relevant Memory

- Facts: stable project/user facts that matter now.
- Preferences: user or team preferences that should shape the response.
- Decisions: prior architecture or product decisions.
- Open Questions: unresolved items or conflicting memories.

### Use In This Turn

State how the retrieved context changes the next action. If it does not change the action, ignore it.
`
  }
};

export async function runSkills(options = {}) {
  const action = options.action ?? "list";
  if (action === "list") return skillsList(options);
  if (action === "install") return skillsInstall(options);
  if (action === "doctor") return skillsDoctor(options);
  throw new Error(`Unknown skills action: ${action}`);
}

export async function skillsList(options = {}) {
  const home = options.home ?? homedir();
  const installed = await installedSkillNames(home);
  const skills = Object.entries(AGENT_SKILLS).map(([name, skill]) => ({
    name,
    title: skill.title,
    installed: installed.includes(name)
  }));
  const result = {
    command: "skills list",
    generatedAt: new Date().toISOString(),
    skills,
    exitCode: 0
  };
  result.text = formatList(result);
  return result;
}

export async function skillsInstall(options = {}) {
  const home = options.home ?? homedir();
  const dryRun = Boolean(options.dryRun);
  const names = options.name ? [options.name] : Object.keys(AGENT_SKILLS);
  const actions = [];

  for (const name of names) {
    const skill = AGENT_SKILLS[name];
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    actions.push(await writeSkill(home, name, skill, dryRun));
  }

  const summary = summarize(actions);
  const result = {
    command: "skills install",
    generatedAt: new Date().toISOString(),
    dryRun,
    actions,
    summary,
    exitCode: summary.failed > 0 ? 1 : 0
  };
  result.text = formatInstall(result);
  return result;
}

export async function skillsDoctor(options = {}) {
  const home = options.home ?? homedir();
  const installed = await installedSkillNames(home);
  const checks = Object.keys(AGENT_SKILLS).map((name) => installed.includes(name)
    ? ok(`${name} installed`)
    : fail(`${name} missing`, "Run smctl skills install"));
  const summary = checks.reduce((acc, check) => {
    acc[check.status] += 1;
    return acc;
  }, { ok: 0, fail: 0 });
  const result = {
    command: "skills doctor",
    generatedAt: new Date().toISOString(),
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatDoctor(result);
  return result;
}

async function writeSkill(home, name, skill, dryRun) {
  const path = join(skillsDir(home), skill.filename);
  const content = `${skill.body.trim()}\n`;
  const existing = await readTextIfExists(path);

  if (existing === content) {
    return { status: "unchanged", name, title: skill.title, path: redactHome(path), detail: "Already installed" };
  }
  if (dryRun) {
    return { status: existing ? "would-update" : "would-create", name, title: skill.title, path: redactHome(path), detail: "Would write markdown skill" };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o644 });
  await chmod(path, 0o644);
  return { status: existing ? "updated" : "created", name, title: skill.title, path: redactHome(path), detail: "Installed markdown skill" };
}

async function installedSkillNames(home) {
  const output = [];
  for (const [name, skill] of Object.entries(AGENT_SKILLS)) {
    if (await exists(join(skillsDir(home), skill.filename))) output.push(name);
  }
  return output;
}

function skillsDir(home) {
  return join(home, ".config", "smctl", "skills");
}

async function readTextIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function summarize(actions) {
  return actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, { created: 0, updated: 0, unchanged: 0, "would-create": 0, "would-update": 0, failed: 0 });
}

function formatList(result) {
  const lines = ["Supermemory Harness skills", ""];
  for (const skill of result.skills) {
    lines.push(`${skill.installed ? "*" : "-"} ${skill.name}  ${skill.title}`);
  }
  return lines.join("\n");
}

function formatInstall(result) {
  const lines = [];
  lines.push("Supermemory Harness skills install");
  lines.push(`Mode: ${result.dryRun ? "dry-run" : "write"}`);
  lines.push(`Summary: ${result.summary.created} created, ${result.summary.updated} updated, ${result.summary.unchanged} unchanged, ${result.summary["would-create"]} would-create, ${result.summary["would-update"]} would-update`);
  lines.push("");
  for (const action of result.actions) {
    lines.push(`${symbol(action.status)} ${action.name}`);
    lines.push(`   ${action.path}`);
    lines.push(`   ${action.detail}`);
  }
  return lines.join("\n");
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness skills doctor");
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${check.status === "ok" ? "[ok]" : "[fail]"} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  return lines.join("\n");
}

function symbol(status) {
  if (["created", "updated", "unchanged"].includes(status)) return "[ok]";
  if (status.startsWith("would-")) return "[plan]";
  return "[fail]";
}

function ok(title, detail) {
  return { status: "ok", title, detail };
}

function fail(title, detail) {
  return { status: "fail", title, detail };
}

function redactHome(path) {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
