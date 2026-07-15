import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEnhance } from "../src/enhance.js";

test("enhance automates the agent-memory readiness path", async () => {
  const home = await fakeHome();
  const result = await runEnhance({
    home,
    cwd: home,
    env: { PATH: "" },
    dryRun: true,
    fetch: fakeFetch
  });

  assert.equal(result.product, "Supermemory Harness");
  assert.equal(result.feature, "Harness Enhance");
  assert.match(result.text, /Supermemory Harness Enhance/);
  assert.match(result.text, /Embedded Supermemory dashboard/);
  assert.match(result.text, /Codex and Claude agent bridge/);
  assert.match(result.text, /smctl supermemory start/);
  assert.match(result.text, /Open http:\/\/localhost:6778/);
  assert.doesNotMatch(result.text, /sm_aaaaaaaa/);
  assert.doesNotMatch(JSON.stringify(result), /sm_aaaaaaaa/);
  assert.equal(result.actions.some((action) => action.title === "Harness plugin layer"), true);
  assert.equal(result.actions.some((action) => action.title === "Codex and Claude agent bridge"), true);
  assert.equal(result.agentBridge.summary.planned, 2);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-enhance-home-"));
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
    return response(200, { memories: [] });
  }
  if (url.endsWith("/v3/documents/processing")) {
    return response(200, { running: 0, queued: 0 });
  }
  if (url.endsWith("/v4/memories/list")) {
    return response(200, { memoryEntries: [], pagination: { totalItems: 0 } });
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
