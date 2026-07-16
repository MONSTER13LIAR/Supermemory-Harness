import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDreams } from "../src/dreams.js";

test("dream flight recorder saves a first snapshot", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-dreams-home-"));
  const result = await runDreams({
    home,
    fetch: fakeFetch([
      { id: "doc_1", status: "processing", title: "Queued profile update", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.diff.firstRun, true);
  assert.equal(result.diff.newDocuments.length, 1);
  assert.match(result.text, /Dream Flight Recorder/);
});

test("dream flight recorder reports status changes since previous snapshot", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-dreams-home-"));
  await runDreams({
    home,
    now: "2026-07-15T00:00:00.000Z",
    fetch: fakeFetch([
      { id: "doc_1", status: "processing", title: "Queued profile update", containerTags: ["project:demo"] },
      { id: "doc_2", status: "processing", title: "Queued contradiction merge", containerTags: ["project:demo"] }
    ])
  });

  const result = await runDreams({
    home,
    now: "2026-07-15T00:05:00.000Z",
    fetch: fakeFetch([
      { id: "doc_1", status: "done", title: "Queued profile update", containerTags: ["project:demo"] },
      { id: "doc_2", status: "failed", title: "Queued contradiction merge", containerTags: ["project:demo"] }
    ])
  });

  assert.equal(result.diff.completed.length, 1);
  assert.equal(result.diff.failed.length, 1);
  assert.equal(result.state.label, "settled");
  assert.match(result.text, /processing -> done/);
  assert.match(result.text, /processing -> failed/);
  assert.equal(result.next, "smctl repair wizard");
});

function fakeFetch(documents) {
  return async (url) => {
    if (url.endsWith("/v3/documents/list")) {
      return response(200, { memories: documents });
    }
    if (url.endsWith("/v3/documents/processing")) {
      const queued = documents.filter((doc) => ["queued", "processing"].includes(doc.status)).length;
      return response(200, { queued, running: 0 });
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
