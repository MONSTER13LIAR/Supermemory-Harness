#!/usr/bin/env node

import { runDoctor } from "../src/doctor.js";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`smctl ${VERSION}

Usage:
  smctl doctor [--json] [--base-url <url>]
  smctl --help
  smctl --version

Commands:
  doctor   Inspect Supermemory Local install, server reachability, and tool configs.
`);
}

function parseArgs(argv) {
  const args = {
    command: null,
    json: false,
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

  if (args.command !== "doctor") {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const result = await runDoctor({
    baseUrl: args.baseUrl,
    cwd: process.cwd(),
    env: process.env
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.text);
  }

  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(`smctl: ${error.message}`);
  process.exitCode = 1;
});
