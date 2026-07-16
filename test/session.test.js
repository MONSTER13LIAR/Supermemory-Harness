import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSession } from "../src/session.js";

test("session pre-action blocks when project memory is not scoped", async () => {
  const home = await fakeHome(false);
  const result = await runSession({
    action: "pre-action",
    home,
    fetch: fakeFetch([])
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.decision.status, "block");
  assert.match(result.text, /session pre-action/);
  assert.match(result.text, /Initialize project memory first/);
});

test("session pre-compact emits the required memory handoff contract", async () => {
  const home = await fakeHome(true);
  const result = await runSession({
    action: "pre-compact",
    home,
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "Project uses Vitest", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.contract.length, 5);
  assert.match(result.text, /Preserve before compacting:/);
  assert.match(result.text, /Files touched/);
  assert.match(result.text, /Supermemory trust state/);
});

test("session stop recommends verify when memory is usable", async () => {
  const home = await fakeHome(true);
  const result = await runSession({
    action: "stop",
    home,
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "Project uses Vitest", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.next, "smctl verify");
  assert.match(result.text, /session can hand off/);
});

async function fakeHome(withProject) {
  const home = await mkdtemp(join(tmpdir(), "smctl-session-home-"));
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
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return response(200, "<html></html>");
    if (path === "/v4/openapi") return response(200, { paths: { "/mcp": {} } });
    if (path === "/v4/profile") return response(200, { profile: { static: [], dynamic: [] } });
    if (path === "/v3/documents/list") return response(200, { memories: documents });
    if (path === "/v3/documents/processing") return response(200, { queued: 0, running: 0 });
    if (path === "/v4/memories/list") {
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
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}
