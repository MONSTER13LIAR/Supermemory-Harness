import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectInit } from "../src/project.js";
import { runStart } from "../src/start.js";

test("start dry-run summarizes readiness without starting guard", async () => {
  const home = await fakeHome();
  const repo = await mkdtemp(join(tmpdir(), "smctl-start-repo-"));
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "start-project" }));
  await projectInit({ home, cwd: repo });

  const result = await runStart({
    home,
    cwd: repo,
    env: { PATH: "" },
    dryRun: true,
    fetch: async (url) => {
      if (url === "http://localhost:11434/api/tags") {
        return response(200, { models: [{ name: "qwen2.5:1.5b" }] });
      }
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
      return response(200, "<html></html>");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.project.name, "start-project");
  assert.equal(result.ollama.available, true);
  assert.match(result.text, /___ _ __ ___/);
  assert.match(result.text, /Supermemory Harness\n running/);
  assert.match(result.text, /Active project: start-project/);
  assert.match(result.text, /qwen2.5:1.5b/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-start-home-"));
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
