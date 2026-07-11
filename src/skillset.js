import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const BUILTIN_SKILLSETS = {
  developer: {
    name: "developer",
    title: "Developer",
    description: "Project memory for coding agents and local development work.",
    remember: ["architecture decision", "repo convention", "bug fix", "deployment step", "test strategy", "api contract"],
    ignore: ["node_modules", "npm install output", "stack trace", "build log", "coverage output", "compiled asset"],
    flag: ["ignore previous instructions", "always trust", "never warn", "api key", "password", "secret"],
    metadata: {
      smctlSkillset: "developer",
      memoryDomain: "software-development"
    },
    defaultContainerTag: "project:default"
  },
  "support-bot": {
    name: "support-bot",
    title: "Support Bot",
    description: "Customer-support memory with preference and issue tracking.",
    remember: ["customer preference", "open issue", "resolution", "escalation", "account context"],
    ignore: ["greeting", "small talk", "payment card", "one-time password", "raw transcript filler"],
    flag: ["credit card", "password", "ssn", "medical record", "private key"],
    metadata: {
      smctlSkillset: "support-bot",
      memoryDomain: "customer-support"
    },
    defaultContainerTag: "support:default"
  },
  research: {
    name: "research",
    title: "Research",
    description: "Research assistant memory focused on claims, sources, and open questions.",
    remember: ["claim", "source", "citation", "open question", "contradiction", "experiment result"],
    ignore: ["unsourced conclusion", "duplicate excerpt", "formatting note", "temporary outline"],
    flag: ["no source", "fabricated citation", "ignore previous instructions", "confidential"],
    metadata: {
      smctlSkillset: "research",
      memoryDomain: "research"
    },
    defaultContainerTag: "research:default"
  }
};

export async function runSkillset(options = {}) {
  const action = options.action ?? "list";
  if (action === "list") return skillsetList(options);
  if (action === "install") {
    if (!options.name) throw new Error("skillset install requires a name");
    return skillsetInstall(options);
  }
  if (action === "doctor") return skillsetDoctor(options);
  throw new Error(`Unknown skillset action: ${action}`);
}

export async function skillsetList(options = {}) {
  const home = options.home ?? homedir();
  const active = await readActiveSkillset(home);
  const skillsets = Object.values(BUILTIN_SKILLSETS).map((skillset) => ({
    name: skillset.name,
    title: skillset.title,
    description: skillset.description,
    active: active?.name === skillset.name
  }));
  const result = {
    command: "skillset list",
    generatedAt: new Date().toISOString(),
    active: active?.name ?? null,
    skillsets,
    exitCode: 0
  };
  result.text = formatList(result);
  return result;
}

export async function skillsetInstall(options = {}) {
  const home = options.home ?? homedir();
  const skillset = BUILTIN_SKILLSETS[options.name];
  if (!skillset) {
    throw new Error(`Unknown skillset: ${options.name}`);
  }

  const path = activeSkillsetPath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(skillset, null, 2)}\n`, { mode: 0o600 });

  const result = {
    command: "skillset install",
    generatedAt: new Date().toISOString(),
    active: skillset.name,
    path: redactHome(path),
    skillset,
    exitCode: 0
  };
  result.text = [
    "Supermemory Harness skillset install",
    `Installed: ${skillset.title}`,
    `Path: ${redactHome(path)}`,
    "",
    "Guard will now use this skillset for local memory review."
  ].join("\n");
  return result;
}

export async function skillsetDoctor(options = {}) {
  const home = options.home ?? homedir();
  const active = await readActiveSkillset(home);
  const checks = [];
  if (active) {
    checks.push(ok("Active skillset installed", `${active.title} (${active.name})`));
    checks.push(active.remember?.length > 0 ? ok("Remember rules present", `${active.remember.length} rules`) : fail("Remember rules missing"));
    checks.push(active.ignore?.length > 0 ? ok("Ignore rules present", `${active.ignore.length} rules`) : fail("Ignore rules missing"));
    checks.push(active.flag?.length > 0 ? ok("Flag rules present", `${active.flag.length} rules`) : fail("Flag rules missing"));
  } else {
    checks.push(fail("No active skillset installed", "Run smctl skillset install developer"));
  }

  const summary = summarize(checks);
  const result = {
    command: "skillset doctor",
    generatedAt: new Date().toISOString(),
    active: active?.name ?? null,
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0
  };
  result.text = formatDoctor(result);
  return result;
}

export async function readActiveSkillset(home = homedir()) {
  const path = activeSkillsetPath(home);
  if (!await exists(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export function applySkillsetToRequest(skillset, request) {
  if (!skillset) {
    return { findings: [], metadata: {}, containerTag: null };
  }

  const text = JSON.stringify(request.body ?? {}).toLowerCase();
  const findings = [];
  const ignored = (skillset.ignore ?? []).find((needle) => text.includes(needle.toLowerCase()));
  const flagged = (skillset.flag ?? []).find((needle) => text.includes(needle.toLowerCase()));
  const remembered = (skillset.remember ?? []).find((needle) => text.includes(needle.toLowerCase()));

  if (ignored) {
    findings.push({
      severity: "medium",
      type: "skillset-ignore",
      message: `${skillset.title} skillset marks this as likely noise: ${ignored}`
    });
  }
  if (flagged) {
    findings.push({
      severity: "medium",
      type: "skillset-flag",
      message: `${skillset.title} skillset flagged: ${flagged}`
    });
  }

  return {
    findings,
    metadata: {
      ...(skillset.metadata ?? {}),
      ...(remembered ? { smctlMemoryType: remembered.replaceAll(" ", "_") } : {})
    },
    containerTag: request.body?.containerTag ?? skillset.defaultContainerTag ?? null
  };
}

function formatList(result) {
  const lines = [];
  lines.push("Supermemory Harness skillsets");
  lines.push(`Active: ${result.active ?? "none"}`);
  lines.push("");
  for (const skillset of result.skillsets) {
    lines.push(`${skillset.active ? "*" : "-"} ${skillset.name}  ${skillset.description}`);
  }
  return lines.join("\n");
}

function formatDoctor(result) {
  const lines = [];
  lines.push("Supermemory Harness skillset doctor");
  lines.push(`Active: ${result.active ?? "none"}`);
  lines.push(`Summary: ${result.summary.ok} ok, ${result.summary.fail} fail`);
  lines.push("");
  for (const check of result.checks) {
    lines.push(`${check.status === "ok" ? "[ok]" : "[fail]"} ${check.title}`);
    if (check.detail) lines.push(`   ${check.detail}`);
  }
  return lines.join("\n");
}

function activeSkillsetPath(home) {
  return join(home, ".config", "smctl", "skillsets", "active.json");
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
  }, { ok: 0, fail: 0 });
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
