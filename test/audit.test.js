import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAudit } from "../src/audit.js";

test("audit passes when identity, scope, grounding, processing, and retrieval are healthy", async () => {
  const home = await fakeHome();
  const result = await runAudit({
    home,
    fetch: fakeFetch({
      documents: [
        {
          id: "doc_1",
          customId: "decision-1",
          status: "done",
          title: "Decision",
          content: "Use Guard for writes",
          containerTags: ["project:demo"],
          filepath: "README.md"
        }
      ],
      openapi: {
        paths: {
          "/v3/search": {},
          "/v4/search": {},
          "/v4/memories/list": {}
        }
      },
      processing: { queued: 0, running: 0 }
    })
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.ok, 5);
  assert.match(result.text, /Duplicate prevention/);
  assert.match(result.text, /Project scoping/);
  assert.match(result.text, /Source grounding/);
  assert.match(result.text, /Processing queue/);
  assert.match(result.text, /Retrieval readiness/);
});

test("audit fails or warns on missing identity, wrong scope, ungrounded docs, failed processing, and missing retrieval routes", async () => {
  const home = await fakeHome();
  const result = await runAudit({
    home,
    fetch: fakeFetch({
      documents: [
        { id: "doc_1", status: "failed", title: "Bad import", content: "failed", containerTags: ["project:demo"] },
        { id: "doc_2", status: "done", title: "No identity", content: "memory", containerTags: ["other"] },
        { id: "doc_3", status: "done", title: "No identity 2", content: "memory", containerTags: ["other"] }
      ],
      openapi: { paths: {} },
      processing: { queued: 0, running: 0 }
    })
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.fail >= 2, true);
  assert.match(result.text, /failed document/);
  assert.match(result.text, /Search routes are missing/);
  assert.match(result.text, /lack customId/);
  assert.match(result.text, /outside project:demo/);
  assert.match(result.text, /Source grounding/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-audit-home-"));
  await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
  await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
    version: 1,
    id: "demo",
    name: "demo",
    root: "/tmp/demo",
    containerTag: "project:demo"
  }));
  return home;
}

function fakeFetch({ documents, openapi, processing }) {
  return async (url) => {
    if (url.endsWith("/v4/openapi")) {
      return response(200, openapi);
    }
    if (url.endsWith("/v3/documents/list")) {
      return response(200, { memories: documents.map(({ content, filepath, url, source, metadata, ...doc }) => doc) });
    }
    if (url.endsWith("/v3/documents/processing")) {
      return response(200, processing);
    }
    const match = String(url).match(/\/v3\/documents\/([^/]+)$/);
    if (match) {
      const doc = documents.find((item) => item.id === match[1]);
      return doc ? response(200, doc) : response(404, { error: "missing" });
    }
    return response(404, { error: "missing" });
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}
