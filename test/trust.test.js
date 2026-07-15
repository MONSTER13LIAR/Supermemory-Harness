import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTrust } from "../src/trust.js";

let latestProbeMarker = "marker";

test("trust doctor reports scoped memory health without writing by default", async () => {
  const home = await fakeHome();
  const result = await runTrust({
    home,
    cwd: home,
    fetch: fakeFetch,
    limit: 20
  });

  assert.equal(result.command, "trust");
  assert.equal(result.mode, "read-only");
  assert.equal(result.probe, null);
  assert.equal(result.checks.some((check) => check.title === "Active project scope"), true);
  assert.equal(result.checks.some((check) => check.title === "Live write/read probe not run"), true);
  assert.match(result.text, /Supermemory Harness Trust Doctor/);
  assert.match(result.text, /Trust:/);
});

test("trust doctor can run the live probe when requested", async () => {
  const home = await fakeHome();
  const result = await runTrust({
    home,
    cwd: home,
    fetch: fakeFetch,
    probe: true,
    sleep: async () => {}
  });

  assert.equal(result.mode, "probe");
  assert.equal(result.probe.command, "verify");
  assert.equal(result.checks.some((check) => check.title === "Live write/read probe" && check.status === "ok"), true);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-trust-home-"));
  await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
    version: 1,
    id: "test-project",
    name: "test-project",
    root: home,
    containerTag: "project:test",
    createdAt: new Date().toISOString()
  }));
  await writeFile(join(home, ".supermemory", "server.log"), "");
  await writeFile(join(home, ".supermemory", "data"), "tiny");
  return home;
}

async function fakeFetch(url, init = {}) {
  const path = new URL(url).pathname;
  if (path === "/" || path === "") return response(200, "<html></html>", "text/html");
  if (path === "/v4/openapi") return response(200, { paths: {} });
  if (path === "/v4/profile") return response(200, { profile: { static: [], dynamic: [] } });
  if (path === "/v3/documents/processing") return response(200, { queued: 0, running: 0 });
  if (path === "/v4/memories/list") {
    return response(200, { memoryEntries: [{ id: "mem-1" }], pagination: { totalItems: 1 } });
  }
  if (path === "/v3/documents/list") {
    return response(200, {
      memories: [{
        id: "doc-1",
        title: "Preference",
        content: "User prefers local-first memory tools for coding projects.",
        status: "done",
        containerTags: ["project:test"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });
  }
  if (path === "/v3/documents" && init.method === "POST") {
    const body = JSON.parse(init.body || "{}");
    latestProbeMarker = String(body.content ?? "").match(/smctl_verify_[a-z0-9_]+/)?.[0] ?? latestProbeMarker;
    return response(200, { id: "probe-doc", status: "queued" });
  }
  if (path === "/v3/documents/probe-doc") {
    return response(200, { id: "probe-doc", status: "done" });
  }
  if (path === "/v3/search") {
    const body = JSON.parse(init.body || "{}");
    if (String(body.containerTag ?? "").includes("wrong-scope") || String(body.q ?? "").startsWith("absent-")) {
      return response(200, { total: 0, results: [] });
    }
    return response(200, { total: 1, results: [{ content: `${body.q || "marker"} ${latestProbeMarker}` }] });
  }
  return response(404, { error: "not found" });
}

function response(status, body, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    headers: {
      get() {
        return contentType;
      }
    }
  };
}
