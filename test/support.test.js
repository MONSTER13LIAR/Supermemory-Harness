import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSupport } from "../src/support.js";

test("support creates a redacted bundle with useful diagnostics", async () => {
  const home = await fakeHome();
  await writeFile(join(home, ".supermemory", "server.log"), "retry failed with api_key=sk-testsecret1234567890\nmcp reconnect ok\n");

  const result = await runSupport({
    home,
    cwd: join(home, "repo"),
    env: { PATH: "" },
    fetch: fakeFetch,
    now: "2026-07-17T10:00:00.000Z"
  });

  assert.equal(result.command, "support");
  assert.equal(result.path, "~/.config/smctl/support/2026-07-17T10-00-00-000Z.md");
  assert.match(result.text, /support bundle/);
  assert.match(result.text, /Doctor/);
  assert.match(result.text, /Trust/);
  assert.doesNotMatch(result.text, /sk-testsecret/);
  assert.doesNotMatch(JSON.stringify(result), /sm_aaaaaaaa/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const written = await readFile(join(home, ".config", "smctl", "support", "2026-07-17T10-00-00-000Z.md"), "utf8");
  assert.match(written, /Share this file/);
  assert.doesNotMatch(written, /sk-testsecret/);
});

test("support dry-run does not write bundle", async () => {
  const home = await fakeHome();
  const result = await runSupport({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: fakeFetch,
    dryRun: true,
    now: "2026-07-17T10:00:00.000Z"
  });

  assert.match(result.path, /2026-07-17T10-00-00-000Z\.md$/);
  assert.match(result.text, /support bundle/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-support-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await mkdir(join(home, "repo"), { recursive: true });
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
        "/v4/search": {},
        "/mcp": {}
      }
    });
  }
  if (url.endsWith("/v3/documents/list")) {
    return response(200, {
      memories: [
        { id: "doc_1", status: "done", title: "Project decision", content: "Use Guard for writes", containerTags: ["project:demo"], filepath: "README.md" }
      ]
    });
  }
  if (url.endsWith("/v3/documents/doc_1")) {
    return response(200, { id: "doc_1", status: "done", title: "Project decision", content: "Use Guard for writes", containerTags: ["project:demo"], filepath: "README.md" });
  }
  if (url.endsWith("/v3/documents/processing")) {
    return response(200, { running: 0, queued: 0 });
  }
  if (url.endsWith("/v4/memories/list")) {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 1 } });
  }
  if (url.endsWith("/v3/search")) {
    return response(200, { results: [{ id: "doc_1", title: "Project decision" }] });
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
