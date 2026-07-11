import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor } from "../src/doctor.js";

test("doctor redacts API key and reports localhost auth limitation separately", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-home-"));
  const cwd = await mkdtemp(join(tmpdir(), "smctl-cwd-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "bin", "supermemory-server.version"), "0.0.3\n");
  await writeFile(join(store, "data"), "");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");

  const result = await runDoctor({
    home,
    cwd,
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
      return response(200, "<html></html>");
    }
  });

  assert.equal(result.apiKey.apiKeyFile.shape, "looks-valid");
  assert.match(result.text, /Localhost auth note/);
  assert.doesNotMatch(result.text, /sm_aaaaaaaa/);
});

test("doctor warns when a project-local store exists beside home store", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-home-"));
  const cwd = await mkdtemp(join(tmpdir(), "smctl-cwd-"));
  await mkdir(join(home, ".supermemory", "bin"), { recursive: true });
  await mkdir(join(cwd, ".supermemory"), { recursive: true });

  const result = await runDoctor({
    home,
    cwd,
    env: { PATH: "" },
    fetch: async () => {
      throw new Error("server offline");
    }
  });

  assert(result.checks.some((check) => check.status === "warn" && check.title.includes("Both home and project-local")));
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof body === "string") throw new Error("not json");
      return body;
    }
  };
}
