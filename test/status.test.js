import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStatus } from "../src/status.js";

test("status summarizes healthy server with memory warnings", async () => {
  const home = await fakeHome();
  const result = await runStatus({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: async (url) => {
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
          memories: [{ id: "doc_failed", status: "failed", title: "Failed note", containerTags: ["repo"] }]
        });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(200, { running: 0, queued: 0 });
      }
      if (url.endsWith("/v4/memories/list")) {
        return response(200, { memoryEntries: [], pagination: { totalItems: 0 } });
      }
      return response(200, "<html></html>");
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Memory Health/);
  assert.match(result.text, /smctl memory doctor/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-status-home-"));
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
