import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWatch } from "../src/watch.js";

test("watch renders the activity bar and focused panels", async () => {
  const home = await fakeHome();
  await writePendingGuardItem(home);

  const result = await runWatch({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.local.status, "online");
  assert.equal(result.memory.queued, 1);
  assert.equal(result.guard.pending, 1);
  assert.equal(result.guard.risk.high, 1);
  assert.match(result.text, /Supermemory Harness Bar/);
  assert.match(result.text, /Local: online \| Agents: 0\/4 \| Writes: 3 \| Queue: 1 \| Dreaming: active \| Guard: 1/);
  assert.match(result.text, /\[memory flow\]/);
  assert.match(result.text, /robot-arm-v1/);
  assert.match(result.text, /Recommended: smctl guard inbox/);
});

test("watch reports offline local state without trying memory endpoints", async () => {
  const home = await fakeHome();
  const seen = [];
  const result = await runWatch({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: async (url) => {
      seen.push(url);
      throw new Error("connect ECONNREFUSED");
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.local.status, "offline");
  assert.equal(result.memory.sampled, 0);
  assert.match(result.text, /Local: offline/);
  assert.match(result.text, /Recommended: smctl doctor/);
  assert.equal(seen.some((url) => url.endsWith("/v3/documents/list")), false);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-watch-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "bin", "supermemory-server.version"), "0.0.3\n");
  await writeFile(join(store, "data"), "");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");
  return home;
}

async function writePendingGuardItem(home) {
  const dir = join(home, ".config", "smctl", "guard");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "pending.json"), `${JSON.stringify([
    {
      id: "guard_1",
      route: "POST /v3/documents",
      risk: {
        level: "high",
        findings: [{ severity: "high", type: "secret", message: "API key-like value detected" }]
      },
      preview: {
        content: "Blocked write containing secret-like text",
        containerTag: "project:harness"
      }
    }
  ], null, 2)}\n`);
}

async function fakeFetch(url) {
  if (url.endsWith("/v4/openapi")) {
    return response(200, {
      paths: {
        "/v3/documents": {},
        "/v3/documents/list": {},
        "/v3/search": {},
        "/v4/conversations": {},
        "/v4/memories": {},
        "/v4/search": {}
      }
    });
  }

  if (url.endsWith("/v3/documents/list")) {
    return response(200, {
      memories: [
        { id: "doc_1", status: "done", title: "Calibration offset improved grip", containerTags: ["hardware:robot-arm-v1"] },
        { id: "doc_2", status: "processing", title: "Motor temperature spike during live test", containerTags: ["hardware:robot-arm-v1"] },
        { id: "doc_3", status: "done", title: "Harness setup note", containerTags: ["project:harness"] }
      ]
    });
  }

  if (url.endsWith("/v3/documents/processing")) {
    return response(200, { running: 1, queued: 1 });
  }

  if (url.endsWith("/v4/memories/list")) {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 1 } });
  }

  return response(200, "<html></html>");
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
