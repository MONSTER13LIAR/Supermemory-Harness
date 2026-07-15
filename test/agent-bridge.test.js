import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgentBridge } from "../src/agent-bridge.js";

test("agent bridge connects codex with Harness instructions", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-agent-home-"));
  await fakeSupermemoryStore(home);
  const result = await runAgentBridge({
    action: "connect",
    target: "codex",
    home,
    cwd: home,
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.actions[0].agent, "codex");
  const bridge = await readFile(join(home, ".codex", "harness", "supermemory-bridge.md"), "utf8");
  assert.match(bridge, /smctl trust --json/);
  assert.match(bridge, /Supermemory Harness Agent Bridge/);
  assert.match(bridge, /Harness Compaction Contract/);
  assert.match(bridge, /Negative constraints/);
});

test("agent bridge dry-run does not write files", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-agent-home-"));
  await fakeSupermemoryStore(home);
  const result = await runAgentBridge({
    action: "connect",
    target: "claude",
    home,
    cwd: home,
    fetch: fakeFetch,
    dryRun: true
  });

  assert.equal(result.summary.planned, 1);
  assert.match(result.text, /Would write Harness agent bridge instructions/);
});

async function fakeFetch(url) {
  const path = new URL(url).pathname;
  if (path === "/" || path === "") return response(200, "<html></html>");
  if (path === "/v4/openapi") return response(200, { paths: {} });
  if (path === "/v4/profile") return response(200, { profile: { static: [], dynamic: [] } });
  if (path === "/v3/documents/list") return response(200, { memories: [] });
  if (path === "/v3/documents/processing") return response(200, { queued: 0 });
  return response(200, {});
}

async function fakeSupermemoryStore(home) {
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "api-key"), `sm_${"a".repeat(87)}\n`);
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}
