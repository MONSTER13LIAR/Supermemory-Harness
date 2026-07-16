import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGate } from "../src/gate.js";

test("pre-action gate blocks when project memory is missing", async () => {
  const home = await fakeHome(false);
  const result = await runGate({ home, fetch: fakeFetch([]) });

  assert.equal(result.exitCode, 1);
  assert.equal(result.decision.status, "block");
  assert.match(result.text, /Initialize project memory first/);
});

test("pre-action gate warns on contradictory project memory", async () => {
  const home = await fakeHome(true);
  const result = await runGate({
    home,
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "test runner is Vitest", containerTags: ["project:demo"] },
      { id: "doc_2", status: "done", title: "test runner is Jest", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.decision.status, "warn");
  assert.match(result.text, /Contradictory project memories/);
});

test("pre-action gate blocks on document inventory failure", async () => {
  const home = await fakeHome(true);
  const result = await runGate({
    home,
    fetch: async () => response(500, { error: "inventory unavailable" })
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.decision.status, "block");
  assert.match(result.text, /Document inventory unavailable/);
});

test("pre-action gate passes when scoped memory has no issues", async () => {
  const home = await fakeHome(true);
  const result = await runGate({
    home,
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "test runner is Vitest for all unit tests", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.decision.status, "pass");
  assert.match(result.text, /Decision: PASS/);
});

async function fakeHome(withProject) {
  const home = await mkdtemp(join(tmpdir(), "smctl-gate-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "");
  await writeFile(join(home, ".supermemory", "data"), "tiny");
  if (withProject) {
    await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
    await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
      version: 1,
      id: "demo",
      name: "demo",
      root: "/tmp/demo",
      containerTag: "project:demo"
    }));
  }
  return home;
}

function fakeFetch(documents) {
  return async (url) => {
    if (url.endsWith("/v3/documents/list")) return response(200, { memories: documents });
    if (url.endsWith("/v3/documents/processing")) return response(200, { queued: 0, running: 0 });
    if (url.endsWith("/v4/memories/list")) {
      return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 1 } });
    }
    return response(404, { error: "missing" });
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}
