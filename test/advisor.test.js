import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAdvisor } from "../src/advisor.js";

test("advisor gives one operating plan across users, agents, Supermemory, and Llama", async () => {
  const home = await fakeHome({ withProject: true, withAgentBridge: true });
  const result = await runAdvisor({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: healthyFetch,
    limit: 10
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.entryPaths.some((path) => path.user.includes("Codex")), true);
  assert.equal(result.communicationPaths.some((path) => path.includes("Guard proxy")), true);
  assert.equal(result.llamaUse.status, "ready");
  assert.match(result.text, /Supermemory Harness Advisor/);
  assert.match(result.text, /How Harness Talks To Supermemory:/);
  assert.match(result.text, /Local Llama Usage:/);
  assert.match(result.text, /Plain English:/);
  assert.match(result.text, /smctl genome apply/);
});

test("advisor blocks launch path when Supermemory Local is offline", async () => {
  const home = await fakeHome({ withProject: false, withAgentBridge: false });
  const result = await runAdvisor({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: async (url) => {
      if (String(url).includes("localhost:11434")) {
        return response(404, { error: "ollama missing" });
      }
      throw new Error("connect ECONNREFUSED");
    },
    limit: 5
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.verdict.status, "block");
  assert.equal(result.next, "smctl supermemory start");
  assert.match(result.text, /Supermemory Local is not reachable/);
  assert.match(result.text, /Result: fix the first advisor blocker before launch/);
});

async function fakeHome({ withProject, withAgentBridge }) {
  const home = await mkdtemp(join(tmpdir(), "smctl-advisor-home-"));
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
    await mkdir(join(home, ".claude", "harness"), { recursive: true });
    await writeFile(join(home, ".codex", "harness", "supermemory-bridge.md"), "bridge");
    await writeFile(join(home, ".claude", "harness", "supermemory-bridge.md"), "bridge");
  }
  return home;
}

async function healthyFetch(url, init = {}) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (parsed.port === "11434" && path === "/api/tags") {
    return response(200, { models: [{ name: "llama3.2:1b-instruct-q4_K_M" }] });
  }
  if (parsed.port === "11434" && path === "/api/generate") {
    return response(200, {
      response: "Works: Harness has a clear operating plan.\nNeeds attention: apply Memory Genome policy.\nNext: run smctl genome apply."
    });
  }
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
  if (path === "/v4/profile") {
    return response(200, {
      profile: {
        static: ["Prefers dependency-free Node CLIs"],
        dynamic: ["Working on Supermemory Harness"],
        buckets: { engineering: { facts: ["Uses Guard for risky writes"] } }
      }
    });
  }
  if (path === "/v3/documents/list") {
    return response(200, {
      memories: [
        doc("doc_1", "Architecture decision: use Guard for writes", "/repo/guard.md"),
        doc("doc_2", "Bug fix: block replay when processing fails", "/repo/memory.md"),
        doc("doc_3", "Repo convention: use node --test", "/repo/package.json")
      ]
    });
  }
  if (path.startsWith("/v3/documents/doc_")) {
    const id = path.split("/").at(-1);
    return response(200, doc(id, "Architecture decision: use Guard for writes", "/repo/guard.md"));
  }
  if (path === "/v3/documents/processing") return response(200, { running: 0, queued: 0 });
  if (path === "/v4/memories/list") {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 3 } });
  }
  if (path === "/v3/search") {
    return response(200, { results: [{ id: "doc_1", title: "Architecture decision: use Guard for writes" }] });
  }
  if (init.method === "POST" && path === "/v3/documents") return response(200, { id: "new_doc" });
  return response(404, { error: "missing" });
}

function doc(id, title, filepath) {
  return {
    id,
    title,
    content: `${title}. Source: ${filepath}.`,
    status: "done",
    containerTags: ["project:harness"],
    filepath,
    customId: id,
    metadata: { source: filepath }
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
