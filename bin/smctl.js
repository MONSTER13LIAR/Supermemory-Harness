#!/usr/bin/env node

import { runDoctor } from "../src/doctor.js";
import { runSetup } from "../src/setup.js";
import { runSmoke } from "../src/smoke.js";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`smctl ${VERSION}

Usage:
  smctl doctor [--json] [--base-url <url>]
  smctl setup [--json] [--dry-run] [--target <all|env|cursor>] [--base-url <url>]
  smctl smoke [--json] [--base-url <url>] [--container-tag <tag>] [--timeout-ms <ms>]
  smctl --help
  smctl --version

Commands:
  doctor   Inspect Supermemory Local install, server reachability, and tool configs.
  setup    Write safe local integration config for Supermemory Local.
  smoke    Ingest and search a harmless marker to verify the memory pipeline.
`);
}

function parseArgs(argv) {
  const args = {
    command: null,
    json: false,
    dryRun: false,
    target: "all",
    containerTag: "smctl-smoke",
    timeoutMs: 30000,
    baseUrl: "http://localhost:6767",
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
    } else if (token === "--base-url") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--base-url requires a value");
      }
      args.baseUrl = value;
      index += 1;
    } else if (!args.command) {
      args.command = token;
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

  if (!["doctor", "setup", "smoke"].includes(args.command)) {
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
