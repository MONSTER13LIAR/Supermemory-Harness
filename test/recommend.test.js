import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRecommend } from "../src/recommend.js";

test("recommend produces ten must-have reasons for a healthy local setup", async () => {
  const home = await fakeHome({ withProject: true, withAgentBridge: true, withRepoEvidence: true });
  const result = await runRecommend({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: healthyFetch,
    limit: 10
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.recommendation.status, "recommend");
  assert.equal(result.features.length, 10);
  assert.equal(result.features.some((item) => item.id === "cloud-migration"), true);
  assert.equal(result.features.some((item) => item.id === "memory-genome"), true);
  assert.equal(result.userFlow[0].command, "smctl enhance");
  assert.equal(result.userFlow.some((item) => item.command === "smctl evidence"), true);
  assert.match(result.text, /Ten Features That Make This A Must/);
  assert.match(result.text, /Senior AI Expert View:/);
  assert.match(result.text, /Supermemory Developer View:/);
  assert.match(result.text, /Recommend as a must-have/);
});

test("recommend blocks when live Supermemory Local checks are offline", async () => {
  const home = await fakeHome({ withProject: false, withAgentBridge: false, withRepoEvidence: true });
  const result = await runRecommend({
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
  assert.equal(result.features.length, 10);
  assert.match(result.next, /smctl supermemory start|smctl doctor/);
  assert.match(result.text, /Do not recommend yet/);
  assert.match(result.text, /blocking live checks/);
});

async function fakeHome({ withProject, withAgentBridge, withRepoEvidence }) {
  const home = await mkdtemp(join(tmpdir(), "smctl-recommend-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "bin", "supermemory-server.version"), "0.0.5\n");
  await writeFile(join(store, "data"), "");
  await writeFile(join(store, "server.log"), "");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");
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
  if (withRepoEvidence) {
    await mkdir(join(home, ".github", "workflows"), { recursive: true });
    await mkdir(join(home, "docs"), { recursive: true });
    await writeFile(join(home, ".github", "workflows", "test.yml"), "name: test\n");
    await writeFile(join(home, "README.md"), "# Supermemory Harness\n");
    await writeFile(join(home, "docs", "hackathon-submission.md"), "# Submission\n");
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
        healthyDoc("doc_1", "Harness gives Supermemory Local a trust cockpit", "/tmp/harness.md"),
        healthyDoc("doc_2", "Guard reviews risky memory writes before storage", "/tmp/guard.md")
      ]
    });
  }
  if (path === "/v3/documents/doc_1") return response(200, healthyDoc("doc_1", "Harness gives Supermemory Local a trust cockpit", "/tmp/harness.md"));
  if (path === "/v3/documents/doc_2") return response(200, healthyDoc("doc_2", "Guard reviews risky memory writes before storage", "/tmp/guard.md"));
  if (path === "/v3/documents/processing") return response(200, { running: 0, queued: 0 });
  if (path === "/v4/memories/list") {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 2 } });
  }
  if (path === "/v3/search") {
    return response(200, { results: [{ id: "doc_1", title: "Harness gives Supermemory Local a trust cockpit" }] });
  }
  if (init.method === "POST" && path === "/v3/documents") return response(200, { id: "new_doc" });
  return response(404, { error: "missing" });
}

function healthyDoc(id, title, filepath) {
  return {
    id,
    status: "done",
    title,
    content: `${title}. Project source: ${filepath}.`,
    containerTags: ["project:harness"],
    source: "test",
    filepath,
    customId: id
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
