import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSupermemoryLogFilter, filterSupermemoryLogChunk, formatHarnessSnapshotLines, prefixLines, runSupermemoryTerminal } from "../src/supermemory-terminal.js";

test("supermemory terminal dry-run shows combined terminal plan", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-supermemory-home-"));
  await mkdir(join(home, ".supermemory", "bin"), { recursive: true });
  const binary = join(home, ".supermemory", "bin", "supermemory-server");
  await writeFile(binary, "");

  const result = await runSupermemoryTerminal({
    action: "start",
    home,
    cwd: home,
    env: { PATH: "" },
    dryRun: true
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Would start Supermemory Local with Harness terminal overlay/);
  assert.match(result.text, /supermemory-server/);
  assert.match(result.text, new RegExp(`Launch cwd: ${escapeRegExp(home)}`));
});

test("supermemory terminal launches from home store by default", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-supermemory-home-"));
  const repo = await mkdtemp(join(tmpdir(), "smctl-supermemory-repo-"));
  await mkdir(join(home, ".supermemory", "bin"), { recursive: true });
  const binary = join(home, ".supermemory", "bin", "supermemory-server");
  await writeFile(binary, "");
  let spawnOptions = null;

  const result = await runSupermemoryTerminal({
    action: "start",
    home,
    cwd: repo,
    env: { PATH: "" },
    startupDelayMs: 60000,
    spawn: (_command, _args, options) => {
      spawnOptions = options;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.kill = () => {
        child.killed = true;
      };
      setImmediate(() => child.emit("exit", 0, null));
      return child;
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(spawnOptions.cwd, home);
});

test("supermemory terminal redacts api keys from prefixed output", () => {
  const lines = prefixLines("supermemory", "api key   sm_abcdefghijklmnopqrstuvwxyz1234567890\nready");

  assert.match(lines, /sm_\[redacted\]/);
  assert.doesNotMatch(lines, /abcdefghijklmnopqrstuvwxyz1234567890/);
});

test("supermemory terminal collapses schema mismatch stack traces", () => {
  const seen = new Set();
  const output = filterSupermemoryLogChunk('error: column "dreaming_status" does not exist\nFailed query: select "dreaming_status" from "document"\n    at queryWithCache (/$bunfs/root/supermemory-server:19:37806)', seen);
  const repeated = filterSupermemoryLogChunk('error: column "dreaming_status" does not exist\nFailed query: select "dreaming_status" from "document"', seen);

  assert.match(output, /Supermemory schema mismatch detected/);
  assert.match(output, /supermemory-server upgrade/);
  assert.doesNotMatch(output, /queryWithCache/);
  assert.equal(repeated, "");
});

test("supermemory terminal collapses missing dreaming table stack traces", () => {
  const seen = new Set();
  const output = filterSupermemoryLogChunk('error: relation "dreaming_job" does not exist\nFailed query: select "dreaming_job"."batch_id" from "dreaming_job"\n    at queryWithCache (/$bunfs/root/supermemory-server:19:37806)', seen);

  assert.match(output, /Supermemory schema mismatch detected/);
  assert.match(output, /dreaming_job/);
  assert.match(output, /supermemory-server upgrade/);
  assert.doesNotMatch(output, /queryWithCache/);
});

test("supermemory terminal collapses repeated auth warning noise", () => {
  const filter = createSupermemoryLogFilter();
  const warning = "[better-auth/magic-link] `allowedAttempts` is ignored: tokens are consumed atomically";

  assert.match(filter(warning), /collapsed repeated Supermemory auth warning/);
  assert.equal(filter(warning), "");
});

test("terminal overlay snapshot shows actionable memory diagnosis", () => {
  const lines = formatHarnessSnapshotLines({
    label: "watchdog",
    now: "2026-07-15T00:00:00.000Z",
    trust: {
      score: { value: 52, label: "Risky" },
      summary: { fail: 1, warn: 2 },
      checks: [
        { status: "fail", title: "Failed memory writes", detail: "2 failed in recent sample" },
        { status: "warn", title: "No active project scope", detail: "Run smctl init" }
      ],
      next: ["smctl repair wizard", "smctl trust --probe"]
    },
    watch: {
      local: {
        mcp: {
          label: "missing",
          detail: "/mcp returned 404; run supermemory-server upgrade, restart with smctl supermemory start, then re-run smctl doctor."
        }
      },
      agents: { configured: 1, total: 4, active: ["codex"] },
      memory: {
        sampled: 8,
        queued: 3,
        failed: 2,
        dreaming: { label: "active" }
      },
      guard: {
        pending: 1,
        risk: { low: 0, medium: 1, high: 0 }
      },
      next: "smctl repair"
    }
  });

  assert.match(lines.join("\n"), /Trust 52\/100 \(Risky\)/);
  assert.match(lines.join("\n"), /blocker: Failed memory writes/);
  assert.match(lines.join("\n"), /agents: 1\/4 configured; active: codex/);
  assert.match(lines.join("\n"), /mcp: missing - \/mcp returned 404/);
  assert.match(lines.join("\n"), /memory: writes 8; queue 3; failed 2; dreaming active/);
  assert.match(lines.join("\n"), /guard: 1 pending; risk low:0 medium:1 high:0/);
  assert.match(lines.join("\n"), /next: smctl repair wizard \| smctl trust --probe/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
