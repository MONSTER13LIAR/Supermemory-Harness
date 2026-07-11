#!/usr/bin/env node

import { runDoctor } from "../src/doctor.js";
import { runGuard } from "../src/guard.js";
import { runInstall } from "../src/install.js";
import { runMemory } from "../src/memory.js";
import { runSetup } from "../src/setup.js";
import { runSkillset } from "../src/skillset.js";
import { runSmart } from "../src/smart.js";
import { runSmoke } from "../src/smoke.js";
import { runStatus } from "../src/status.js";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`smctl ${VERSION}

Usage:
  smctl install [--json] [--dry-run] [--base-url <url>] [--guard-url <url>]
  smctl status [--json] [--base-url <url>] [--limit <n>]
  smctl doctor [--json] [--base-url <url>]
  smctl setup [--json] [--dry-run] [--target <all|env|cursor>] [--base-url <url>]
  smctl smoke [--json] [--base-url <url>] [--container-tag <tag>] [--timeout-ms <ms>]
  smctl memory doctor [--json] [--base-url <url>] [--limit <n>]
  smctl memory replay [--json] [--base-url <url>] [--limit <n>] [--apply]
  smctl skillset list [--json]
  smctl skillset install <name> [--json]
  smctl skillset doctor [--json]
  smctl smart enable [--json] [--provider <openai|gemini|anthropic>] [--api-key-env <name>] [--model <model>] [--yes]
  smctl smart doctor [--json]
  smctl smart disable [--json]
  smctl guard start [--port <port>] [--upstream <url>]
  smctl guard inbox [--json]
  smctl guard approve <id> [--json] [--upstream <url>]
  smctl guard reject <id> [--json]
  smctl --help
  smctl --version

Commands:
  install  Install and connect the full Supermemory Harness plugin.
  status   Show one-screen health for Supermemory, memory, and Guard.
  doctor   Inspect Supermemory Local install, server reachability, and tool configs.
  setup    Write safe local integration config for Supermemory Local.
  smoke    Ingest and search a harmless marker to verify the memory pipeline.
  memory   Inspect memory quality, failed docs, and recall health.
  skillset Install app-specific local memory policies.
  smart    Enable optional env-based LLM assistance.
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
    yes: false,
    target: "all",
    provider: null,
    apiKeyEnv: null,
    model: null,
    containerTag: "smctl-smoke",
    timeoutMs: 30000,
    limit: 50,
    port: 6777,
    upstream: "http://localhost:6767",
    baseUrl: "http://localhost:6767",
    guardUrl: "http://localhost:6777",
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
    } else if (token === "--yes") {
      args.yes = true;
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
    } else if (!args.command) {
      args.command = token;
    } else if (args.command === "guard" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "guard" && !args.id) {
      args.id = token;
    } else if (args.command === "memory" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "skillset" && !args.subcommand) {
      args.subcommand = token;
    } else if (args.command === "skillset" && !args.id) {
      args.id = token;
    } else if (args.command === "smart" && !args.subcommand) {
      args.subcommand = token;
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

  if (args.help || !args.command) {
    printHelp();
    return;
  }

  if (!["install", "status", "doctor", "setup", "smoke", "memory", "skillset", "smart", "guard"].includes(args.command)) {
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
    return runInstall({
      baseUrl: args.baseUrl,
      guardUrl: args.guardUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      dryRun: args.dryRun,
      fetch: globalThis.fetch
    });
  }

  if (args.command === "status") {
    return runStatus({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env,
      home: process.env.HOME,
      fetch: globalThis.fetch,
      limit: args.limit
    });
  }

  if (args.command === "doctor") {
    return runDoctor({
      baseUrl: args.baseUrl,
      cwd: process.cwd(),
      env: process.env
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
      apply: args.apply
    });
  }

  if (args.command === "skillset") {
    return runSkillset({
      action: args.subcommand,
      name: args.id,
      home: process.env.HOME
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
      yes: args.yes
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
