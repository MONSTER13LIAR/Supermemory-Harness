import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSupermemoryTerminal } from "../src/supermemory-terminal.js";

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
