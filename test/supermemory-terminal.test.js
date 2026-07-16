import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatHarnessSnapshotLines, runSupermemoryTerminal } from "../src/supermemory-terminal.js";

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
