#!/usr/bin/env node

import { runDoctor } from "../src/doctor.js";
import { runDreams } from "../src/dreams.js";
import { runAgentBridge } from "../src/agent-bridge.js";
import { runAudit } from "../src/audit.js";
import { runBackup } from "../src/backup.js";
import { runEnhance } from "../src/enhance.js";
import { runExecutive } from "../src/executive.js";
import { runGuard } from "../src/guard.js";
import { runGate } from "../src/gate.js";
import { runHardware } from "../src/hardware.js";
import { runLaunch } from "../src/launch.js";
import { localBrainDoctor } from "../src/local-brain.js";
import { runMemory } from "../src/memory.js";
import { runMigrate } from "../src/migrate.js";
import { runProject } from "../src/project.js";
import { runRecommend } from "../src/recommend.js";
import { runSetup } from "../src/setup.js";
import { runCleanup } from "../src/cleanup.js";
import { runScore } from "../src/score.js";
import { runSession } from "../src/session.js";
import { runSkillset } from "../src/skillset.js";
import { runSkills } from "../src/skills.js";
import { runSmart } from "../src/smart.js";
import { runSmoke } from "../src/smoke.js";
import { runStart } from "../src/start.js";
import { runStatus } from "../src/status.js";
import { runSupermemoryTerminal } from "../src/supermemory-terminal.js";
import { runSupport } from "../src/support.js";
import { runRepair, runRepairWizard } from "../src/repair.js";
import { runTimeline } from "../src/timeline.js";
import { runTrust } from "../src/trust.js";
import { runUi } from "../src/ui.js";
import { runVerify } from "../src/verify.js";
import { runWatch } from "../src/watch.js";
import { runWorkflow } from "../src/workflow.js";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`smctl ${VERSION}

Usage:
  smctl install [--json] [--dry-run] [--base-url <url>] [--guard-url <url>] [--provider <openai|gemini|anthropic>] [--model <model>]
  smctl enhance [--json] [--dry-run] [--explain] [--base-url <url>] [--guard-url <url>] [--supermemory-source <path>]
  smctl executive [--json] [--base-url <url>] [--limit <n>]
  smctl start [--json] [--dry-run] [--base-url <url>] [--port <port>] [--upstream <url>]
  smctl watch [--json] [--base-url <url>] [--limit <n>]
  smctl workflow [--json] [--base-url <url>] [--limit <n>]
  smctl launch [--json] [--base-url <url>] [--cloud-url <url>] [--limit <n>]
  smctl recommend [--json] [--base-url <url>] [--cloud-url <url>] [--limit <n>]
  smctl support [--json] [--dry-run] [--base-url <url>] [--limit <n>]
  smctl backup [--json] [--dry-run]
  smctl audit [--json] [--base-url <url>] [--limit <n>]
  smctl trust [--json] [--base-url <url>] [--limit <n>] [--probe] [--timeout-ms <ms>]
  smctl gate [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl supermemory start [--json] [--dry-run] [--base-url <url>] [--interval-ms <ms>]
  smctl agent connect [codex|claude|all] [--json] [--dry-run] [--base-url <url>]
  smctl agent status [--json]
  smctl session pre-action|pre-compact|stop [--json] [--base-url <url>] [--limit <n>]
  smctl ui [--port <port>] [--upstream <url>]
  smctl status [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl score [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl verify [--json] [--explain] [--base-url <url>] [--container-tag <tag>] [--timeout-ms <ms>]
  smctl repair [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl repair wizard [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl doctor [--json] [--base-url <url>]
  smctl dreams [--json] [--dry-run] [--explain] [--base-url <url>] [--limit <n>]
  smctl init [--json]
  smctl project [--json] [--base-url <url>] [--limit <n>]
  smctl setup [--json] [--dry-run] [--target <all|env|cursor>] [--base-url <url>]
  smctl smoke [--json] [--base-url <url>] [--container-tag <tag>] [--timeout-ms <ms>]
  smctl memory doctor [--json] [--base-url <url>] [--limit <n>]
  smctl memory replay [--json] [--base-url <url>] [--limit <n>] [--apply]
  smctl memory coach [--json] [--explain] [--base-url <url>] [--limit <n>]
  smctl migrate doctor [--json] [--base-url <url>] [--cloud-url <url>] [--limit <n>] [--redact]
  smctl migrate plan [--json] [--base-url <url>] [--cloud-url <url>] [--limit <n>] [--redact]
  smctl migrate review [--json] [--base-url <url>] [--cloud-url <url>] [--limit <n>] [--redact]
  smctl migrate cloud [--json] [--dry-run] [--apply] [--redact] [--base-url <url>] [--cloud-url <url>] [--cloud-api-key-env <name>] [--limit <n>]
  smctl migrate retry [--json] [--redact] [--base-url <url>] [--cloud-url <url>] [--cloud-api-key-env <name>] [--limit <n>]
  smctl migrate verify [--json] [--cloud-url <url>] [--cloud-api-key-env <name>]
  smctl migrate receipt [--json]
  smctl migrate report [--json]
  smctl timeline [--json] [--base-url <url>] [--limit <n>]
  smctl cleanup [--json] [--base-url <url>] [--limit <n>]
  smctl hardware init [--json] [--name <device>] [--device <id>] [--project <name>]
  smctl hardware ingest [--json] [--dry-run] [--from <log-file>] [--device <id>] [--session <name>] [--base-url <url>]
  smctl hardware observe [--json] [--dry-run] [--stdin] [--device <id>] [--session <name>] [--base-url <url>]
  smctl hardware coach [--json] [--device <id>] [--base-url <url>] [--limit <n>]
  smctl hardware replay [--json] [--device <id>] [--base-url <url>] [--limit <n>]
  smctl skillset list [--json]
  smctl skillset install <name> [--json]
  smctl skillset doctor [--json]
  smctl skills list [--json]
  smctl skills install [--json] [--dry-run]
  smctl skills doctor [--json]
  smctl smart enable [--json] [--provider <openai|gemini|anthropic>] [--api-key-env <name>] [--model <model>] [--prompt] [--yes]
  smctl smart doctor [--json]
  smctl smart ping [--json]
  smctl smart disable [--json]
  smctl brain doctor [--json] [--ollama-model <model>]
  smctl guard start [--port <port>] [--upstream <url>]
  smctl guard inbox [--json]
  smctl guard approve <id> [--json] [--upstream <url>]
  smctl guard reject <id> [--json]
  smctl help
  smctl --help
  smctl --version

Commands:
  install  Install and automatically activate the full Supermemory Harness plugin.
  enhance  Automatically make Supermemory Local agent-memory ready.
  executive Run the daily/final readiness cockpit for Supermemory operations.
  start    Run the project-aware Guard/enrichment layer.
  watch    Show a compact activity bar for Local, agents, memory flow, and Guard.
  workflow Show the simple install-to-trust workflow and moral automation boundaries.
  launch   Show final demo readiness, recommendation, proof checklist, and judge script.
  recommend Explain why senior AI users and Supermemory developers should recommend Harness.
  support  Create a redacted support bundle for debugging Supermemory Local issues.
  backup   Create a data-only local backup of Supermemory Local state without secrets.
  audit    Check duplicate prevention, scope, grounding, processing, and retrieval readiness.
  trust    Decide whether Supermemory memory is scoped, healthy, and safe to rely on.
  gate     Run the pre-action memory governance gate before edits/tests.
  supermemory Start Supermemory Local with Harness health events in the same terminal.
  agent    Connect Codex/Claude-style agents to Harness diagnostics.
  session  Hookable coding-agent lifecycle gates for pre-action, compaction, and stop.
  ui       Embed the Harness Bar into the Supermemory dashboard through a local proxy.
  status   Show one-screen health for Supermemory, memory, and Guard.
  score    Show one confidence number for Supermemory memory/retrieval health.
  verify   Prove write, recall, project scoping, and language recall work.
  repair   Diagnose stuck docs, retry loops, store growth, and recall mismatch risks.
  doctor   Inspect Supermemory Local install, server reachability, and tool configs.
  dreams   Record and compare Supermemory processing/dreaming snapshots.
  init     Detect the current project and create a project-aware memory profile.
  project  Show the active project memory dashboard.
  setup    Write safe local integration config for Supermemory Local.
  smoke    Ingest and search a harmless marker to verify the memory pipeline.
  memory   Inspect memory quality, failed docs, and recall health.
  migrate  Move useful Supermemory Local knowledge to Supermemory Cloud with review and verification.
  timeline Show recent Supermemory write activity by day and container.
  cleanup  Plan safe cleanup for duplicates, test markers, vague notes, and secrets.
  hardware Capture hardware/robot logs as local Supermemory experience memories.
  skillset Install app-specific local memory policies.
  skills   Install markdown skills that teach agents better Supermemory behavior.
  smart    Enable optional env-based LLM assistance.
  brain    Use local Ollama/Llama for plain-English Harness explanations.
  guard    Review memory writes before they are committed to Supermemory Local.
`);
}

function parseArgs(argv) {
  const args = {
    command: null,
    subcommand: null,
    id: null,
    json: false,
    dryRun: false,
    apply: false,
    redact: false,
    yes: false,
    prompt: false,
    probe: false,
    explain: false,
    target: "all",
    provider: null,
    apiKeyEnv: null,
    model: null,
    name: null,
    device: null,
    project: null,
    session: null,
    from: null,
    stdin: false,
    serial: null,
    mqtt: null,
    ollamaModel: "llama3.2:1b-instruct-q4_K_M",
    containerTag: null,
    timeoutMs: 30000,
    limit: 50,
    intervalMs: 30000,
    port: 6777,
    upstream: "http://localhost:6767",
    baseUrl: "http://localhost:6767",
    guardUrl: "http://localhost:6777",
    cloudUrl: null,
    cloudApiKeyEnv: "SUPERMEMORY_CLOUD_API_KEY",
    sourcePath: null,
    help: false,
    version: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--version" || token === "-v") {
      args.version = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--apply") {
      args.apply = true;
    } else if (token === "--redact") {
      args.redact = true;
    } else if (token === "--yes") {
      args.yes = true;
    } else if (token === "--prompt") {
      args.prompt = true;
    } else if (token === "--probe") {
      args.probe = true;
    } else if (token === "--explain") {
      args.explain = true;
    } else if (token === "--provider") {
      const value = argv[index + 1];
      if (!value) throw new Error("--provider requires a value");
      args.provider = value;
      index += 1;
    } else if (token === "--api-key-env") {
      const value = argv[index + 1];
      if (!value) throw new Error("--api-key-env requires a value");
      args.apiKeyEnv = value;
      index += 1;
    } else if (token === "--model") {
      const value = argv[index + 1];
      if (!value) throw new Error("--model requires a value");
      args.model = value;
      index += 1;
    } else if (token === "--name") {
      const value = argv[index + 1];
      if (!value) throw new Error("--name requires a value");
      args.name = value;
      index += 1;
    } else if (token === "--device") {
      const value = argv[index + 1];
      if (!value) throw new Error("--device requires a value");
      args.device = value;
      index += 1;
    } else if (token === "--project") {
      const value = argv[index + 1];
      if (!value) throw new Error("--project requires a value");
      args.project = value;
      index += 1;
    } else if (token === "--session") {
      const value = argv[index + 1];
      if (!value) throw new Error("--session requires a value");
      args.session = value;
      index += 1;
    } else if (token === "--from") {
      const value = argv[index + 1];
      if (!value) throw new Error("--from requires a value");
      args.from = value;
      index += 1;
    } else if (token === "--stdin") {
      args.stdin = true;
    } else if (token === "--serial") {
      const value = argv[index + 1];
      if (!value) throw new Error("--serial requires a value");
      args.serial = value;
      index += 1;
    } else if (token === "--mqtt") {
      const value = argv[index + 1];
      if (!value) throw new Error("--mqtt requires a value");
      args.mqtt = value;
      index += 1;
    } else if (token === "--ollama-model") {
      const value = argv[index + 1];
      if (!value) throw new Error("--ollama-model requires a value");
      args.ollamaModel = value;
      index += 1;
    } else if (token === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--target requires a value");
      }
      args.target = value;
      index += 1;
    } else if (token === "--container-tag") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--container-tag requires a value");
      }
      args.containerTag = value;
      index += 1;
    } else if (token === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive integer");
      }
      args.timeoutMs = value;
      index += 1;
    } else if (token === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      args.limit = value;
      index += 1;
    } else if (token === "--interval-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--interval-ms requires a positive integer");
      }
      args.intervalMs = value;
      index += 1;
    } else if (token === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error("--port requires a valid port number");
      }
      args.port = value;
      index += 1;
    } else if (token === "--upstream") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--upstream requires a value");
      }
      args.upstream = value;
      index += 1;
    } else if (token === "--base-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--base-url requires a value");
      }
      args.baseUrl = value;
      index += 1;
    } else if (token === "--guard-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--guard-url requires a value");
      }
      args.guardUrl = value;
      index += 1;
    } else if (token === "--cloud-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cloud-url requires a value");
      }
      args.cloudUrl = value;
      index += 1;
    } else if (token === "--cloud-api-key-env") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cloud-api-key-env requires a value");
      }
      args.cloudApiKeyEnv = value;
      index += 1;
    } else if (token === "--supermemory-source") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--supermemory-source requires a value");
      }
      args.sourcePath = value;
      index += 1;
    } else if (!args.command) {
      args.command = token;
    } else if (args.command === "guard" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "guard" && !args.id) {
      args.id = token;
    } else if (args.command === "memory" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "migrate" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "session" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "hardware" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "repair" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "skillset" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "skillset" && !args.id) {
      args.id = token;
    } else if (args.command === "skills" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "skills" && !args.id) {
      args.id = token;
    } else if (args.command === "smart" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "brain" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "supermemory" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "agent" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "agent" && !args.id) {
      args.id = token;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    return;
  }

  if (args.help || !args.command || args.command === "help") {
    printHelp();
    return;
  }

  if (!["install", "enhance", "executive", "start", "watch", "workflow", "launch", "recommend", "support", "backup", "audit", "trust", "gate", "supermemory", "agent", "session", "ui", "status", "score", "verify", "repair", "doctor", "dreams", "init", "project", "setup", "smoke", "memory", "migrate", "timeline", "cleanup", "hardware", "skillset", "skills", "smart", "brain", "guard"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const result = await runCommand(args);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.text);
  }

  process.exitCode = result.exitCode;
}

async function runCommand(args) {
  if (args.command === "install") {
    return runEnhance({
      baseUrl: args.baseUrl,
      guardUrl: args.guardUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      dryRun: args.dryRun,
      sourcePath: args.sourcePath,
      explain: args.explain,
      ollamaModel: args.ollamaModel,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "enhance") {
    return runEnhance({
      baseUrl: args.baseUrl,
      guardUrl: args.guardUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      dryRun: args.dryRun,
      sourcePath: args.sourcePath,
      explain: args.explain,
      ollamaModel: args.ollamaModel,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "executive") {
    return runExecutive({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "start") {
    return runStart({
      baseUrl: args.baseUrl,
      upstream: args.upstream,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      port: args.port,
      dryRun: args.dryRun,
      explain: args.explain,
      ollamaModel: args.ollamaModel,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "watch") {
    return runWatch({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "workflow") {
    return runWorkflow({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "launch") {
    return runLaunch({
      baseUrl: args.baseUrl,
      cloudUrl: args.cloudUrl,
      cloudApiKeyEnv: args.cloudApiKeyEnv,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "recommend") {
    return runRecommend({
      baseUrl: args.baseUrl,
      cloudUrl: args.cloudUrl,
      cloudApiKeyEnv: args.cloudApiKeyEnv,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "support") {
    return runSupport({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      dryRun: args.dryRun
    });
  }

  if (args.command === "backup") {
    return runBackup({
      home: process.env.HOME,
      dryRun: args.dryRun
    });
  }

  if (args.command === "audit") {
    return runAudit({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "trust") {
    return runTrust({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      probe: args.probe,
      timeoutMs: args.timeoutMs
    });
  }

  if (args.command === "gate") {
    return runGate({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "ui") {
    return runUi({
      upstream: args.upstream,
      port: args.port === 6777 ? 6778 : args.port,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "dreams") {
    return runDreams({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      dryRun: args.dryRun,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "supermemory") {
    return runSupermemoryTerminal({
      action: args.subcommand,
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      dryRun: args.dryRun,
      intervalMs: args.intervalMs
    });
  }

  if (args.command === "agent") {
    return runAgentBridge({
      action: args.subcommand,
      target: args.id ?? "all",
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      dryRun: args.dryRun
    });
  }

  if (args.command === "session") {
    return runSession({
      action: args.subcommand,
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "status") {
    return runStatus({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "score") {
    return runScore({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "verify") {
    return runVerify({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      home: process.env.HOME,
      fetch: globalThis.fetch,
      containerTag: args.containerTag,
      timeoutMs: args.timeoutMs,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "repair") {
    if (args.subcommand === "wizard") {
      return runRepairWizard({
        baseUrl: args.baseUrl,
        home: process.env.HOME,
        fetch: globalThis.fetch,
        limit: args.limit,
        explain: args.explain,
        ollamaModel: args.ollamaModel
      });
    }
    if (args.subcommand) {
      throw new Error("Unknown repair action. Use: smctl repair wizard");
    }
    return runRepair({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "doctor") {
    return runDoctor({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env
    });
  }

  if (args.command === "init") {
    return runProject({
      action: "init",
      cwd: process.cwd(),
      home: process.env.HOME
    });
  }

  if (args.command === "project") {
    return runProject({
      action: "dashboard",
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "setup") {
    return runSetup({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      target: args.target,
      dryRun: args.dryRun
    });
  }

  if (args.command === "guard") {
    return runGuard({
      action: args.subcommand,
      id: args.id,
      home: process.env.HOME,
      port: args.port,
      upstream: args.upstream,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "memory") {
    return runMemory({
      action: args.subcommand,
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit,
      apply: args.apply,
      explain: args.explain,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "migrate") {
    return runMigrate({
      action: args.subcommand,
      baseUrl: args.baseUrl,
      cloudUrl: args.cloudUrl,
      cloudApiKeyEnv: args.cloudApiKeyEnv,
      home: process.env.HOME,
      env: process.env,
      fetch: globalThis.fetch,
      limit: args.limit,
      dryRun: args.dryRun,
      apply: args.apply,
      redact: args.redact
    });
  }

  if (args.command === "timeline") {
    return runTimeline({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "cleanup") {
    return runCleanup({
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "hardware") {
    return runHardware({
      action: args.subcommand,
      baseUrl: args.baseUrl,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      dryRun: args.dryRun,
      name: args.name,
      device: args.device,
      project: args.project,
      session: args.session,
      from: args.from,
      stdin: args.stdin ? process.stdin : null,
      serial: args.serial,
      mqtt: args.mqtt,
      limit: args.limit,
      ollamaModel: args.ollamaModel
    });
  }

  if (args.command === "skillset") {
    return runSkillset({
      action: args.subcommand,
      name: args.id,
      home: process.env.HOME
    });
  }

  if (args.command === "skills") {
    return runSkills({
      action: args.subcommand,
      name: args.id,
      home: process.env.HOME,
      dryRun: args.dryRun
    });
  }

  if (args.command === "smart") {
    return runSmart({
      action: args.subcommand,
      home: process.env.HOME,
      env: process.env,
      provider: args.provider,
      apiKeyEnv: args.apiKeyEnv,
      model: args.model,
      yes: args.yes,
      prompt: args.prompt,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "brain") {
    if (args.subcommand !== "doctor") {
      throw new Error("Unknown brain action. Use: smctl brain doctor");
    }
    return localBrainDoctor({
      fetch: globalThis.fetch,
      ollamaModel: args.ollamaModel
    });
  }

  return runSmoke({
    baseUrl: args.baseUrl,
    home: process.env.HOME,
    fetch: globalThis.fetch,
    containerTag: args.containerTag,
    timeoutMs: args.timeoutMs
  });
}

main().catch((error) => {
  console.error(`smctl: ${error.message}`);
  process.exitCode = 1;
});
