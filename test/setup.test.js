import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSetup } from "../src/setup.js";

test("setup dry-run reports planned writes without leaking the API key", async () => {
  const home = await fakeHome();
  const result = await runSetup({ home, dryRun: true });

  assert.equal(result.summary["would-create"], 2);
  assert.equal(result.summary.manual, 4);
  assert.doesNotMatch(result.text, /sm_aaaaaaaa/);
  assert.doesNotMatch(JSON.stringify(result), /sm_aaaaaaaa/);
});

test("setup writes env file and Cursor MCP config", async () => {
  const home = await fakeHome();
  const result = await runSetup({ home });

  assert.equal(result.summary.created, 2);
  const env = await readFile(join(home, ".config", "smctl", "supermemory.env"), "utf8");
  assert.match(env, /SUPERMEMORY_CODEX_API_KEY=/);

  const cursor = JSON.parse(await readFile(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(cursor.mcpServers["supermemory-local"].url, "http://localhost:6767/mcp");
  assert.match(cursor.mcpServers["supermemory-local"].headers.Authorization, /^Bearer sm_/);
});

test("setup is idempotent after files already match", async () => {
  const home = await fakeHome();
  await runSetup({ home });
  const result = await runSetup({ home });

  assert.equal(result.summary.unchanged, 2);
});

test("setup target limits actions", async () => {
  const home = await fakeHome();
  const result = await runSetup({ home, target: "cursor", dryRun: true });

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].title, "Configure Cursor MCP");
  assert.equal(result.summary.manual, 0);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-setup-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "api-key"), `sm_${"a".repeat(87)}\n`);
  return home;
}
