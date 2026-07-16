import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runExecutive } from "../src/executive.js";

test("executive check returns a daily readiness board", async () => {
  const home = await fakeHome(true, true);
  const result = await runExecutive({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "Project uses Vitest", containerTags: ["project:demo"] },
      { id: "doc_2", status: "done", title: "Guard protects risky writes", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.readiness.status, "ready");
  assert.equal(result.board.some((item) => item.id === "trust" && item.status === "ready"), true);
  assert.equal(result.actions[0].command, "smctl trust --probe");
  assert.deepEqual(result.finalChecks.slice(0, 2), ["npm test", "smctl executive"]);
  assert.match(result.text, /Executive Board:/);
  assert.match(result.text, /Final Checks Before Hosting:/);
});

test("executive check blocks when Supermemory Local is offline", async () => {
  const home = await fakeHome(false, false);
  const result = await runExecutive({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.readiness.status, "block");
  assert.equal(result.actions[0].command, "smctl supermemory start");
  assert.match(result.text, /Readiness: BLOCK/);
});

async function fakeHome(withProject, withAgentBridge) {
  const home = await mkdtemp(join(tmpdir(), "smctl-executive-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "bin", "supermemory-server.version"), "0.0.3\n");
  await writeFile(join(store, "data"), "");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");
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
  if (withAgentBridge) {
    await mkdir(join(home, ".codex", "harness"), { recursive: true });
    await writeFile(join(home, ".codex", "harness", "supermemory-bridge.md"), "bridge");
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
    async json() {
      if (typeof body === "string") throw new Error("not json");
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    headers: {
      get() {
        return "application/json";
      }
    }
  };
}
