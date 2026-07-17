import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLaunch } from "../src/launch.js";

test("launch board gives a recommendable final demo package when core signals are healthy", async () => {
  const home = await fakeHome({ withProject: true, withAgentBridge: true });
  const result = await runLaunch({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: healthyFetch,
    limit: 10
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.recommendation.status, "recommend");
  assert.equal(result.score.value >= 85, true);
  assert.equal(result.board.some((item) => item.id === "trust" && item.status === "ok"), true);
  assert.equal(result.proofChecklist.some((item) => item.command === "smctl trust --probe"), true);
  assert.equal(result.demoScript.length, 5);
  assert.match(result.text, /Supermemory Harness launch board/);
  assert.match(result.text, /Why it can win:/);
  assert.match(result.text, /Judge Demo Script:/);
  assert.match(result.text, /AI Expert Brief:/);
});

test("launch board blocks recommendation when Supermemory Local is offline", async () => {
  const home = await fakeHome({ withProject: false, withAgentBridge: false });
  const result = await runLaunch({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    },
    limit: 10
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.recommendation.status, "block");
  assert.equal(result.score.value < 60, true);
  assert.match(result.next, /smctl supermemory start|smctl doctor/);
  assert.match(result.text, /Do not recommend yet/);
  assert.match(result.text, /fix the blocking launch checks/i);
});

async function fakeHome({ withProject, withAgentBridge }) {
  const home = await mkdtemp(join(tmpdir(), "smctl-launch-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "bin", "supermemory-server.version"), "0.0.5\n");
  await writeFile(join(store, "data"), "");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");
  await writeFile(join(store, "server.log"), "");
  if (withProject) {
    await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
    await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
      version: 1,
      id: "harness",
      name: "Supermemory Harness",
      root: home,
      containerTag: "project:harness"
    }));
  }
  if (withAgentBridge) {
    await mkdir(join(home, ".codex", "harness"), { recursive: true });
    await writeFile(join(home, ".codex", "harness", "supermemory-bridge.md"), "bridge");
  }
  return home;
}

async function healthyFetch(url, init = {}) {
  const path = new URL(url).pathname;
  if (path === "/" || path === "") return response(200, "<html></html>");
  if (path === "/mcp") return response(405, { error: "method not allowed" });
  if (path === "/v4/openapi") {
    return response(200, {
      paths: {
        "/v3/documents": {},
        "/v3/documents/list": {},
        "/v3/search": {},
        "/v4/conversations": {},
        "/v4/memories": {},
        "/v4/search": {},
        "/mcp": {}
      }
    });
  }
  if (path === "/v4/profile") return response(200, { profile: { static: [], dynamic: [] } });
  if (path === "/v3/documents/list") {
    return response(200, {
      memories: [
        {
          id: "doc_1",
          status: "done",
          title: "Supermemory Harness makes local agent memory trustworthy",
          content: "Harness adds trust checks, guardrails, launch proof, and cloud migration review.",
          containerTags: ["project:harness"],
          source: "test",
          filepath: "/tmp/harness.md"
        },
        {
          id: "doc_2",
          status: "done",
          title: "Guard protects risky memory writes",
          content: "Risky captures are reviewed before becoming durable memory.",
          containerTags: ["project:harness"],
          source: "test",
          filepath: "/tmp/guard.md"
        }
      ]
    });
  }
  if (path === "/v3/documents/doc_1") {
    return response(200, {
      id: "doc_1",
      status: "done",
      title: "Supermemory Harness makes local agent memory trustworthy",
      content: "Harness adds trust checks, guardrails, launch proof, and cloud migration review.",
      containerTags: ["project:harness"],
      source: "test",
      filepath: "/tmp/harness.md"
    });
  }
  if (path === "/v3/documents/doc_2") {
    return response(200, {
      id: "doc_2",
      status: "done",
      title: "Guard protects risky memory writes",
      content: "Risky captures are reviewed before becoming durable memory.",
      containerTags: ["project:harness"],
      source: "test",
      filepath: "/tmp/guard.md"
    });
  }
  if (path === "/v3/documents/processing") return response(200, { running: 0, queued: 0 });
  if (path === "/v4/memories/list") {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 2 } });
  }
  if (path === "/v3/search") {
    return response(200, { results: [{ id: "doc_1", title: "Supermemory Harness makes local agent memory trustworthy" }] });
  }
  if (init.method === "POST" && path === "/v3/documents") return response(200, { id: "new_doc" });
  return response(404, { error: "missing" });
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
