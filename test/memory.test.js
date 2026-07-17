import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memoryDoctor, memoryReplay } from "../src/memory.js";

test("memory doctor reports failed documents and log failures", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "[Workflow] Document doc_failed memory agent failed (4ms)\n");

  const result = await memoryDoctor({
    home,
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Bad memory", containerTags: ["repo"] },
            { id: "doc_done", status: "done", title: "Good memory", containerTags: ["repo"] }
          ]
        });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(200, { running: 0, queued: 0 });
      }
      if (url.endsWith("/v4/memories/list")) {
        return response(200, { memoryEntries: [], pagination: { totalItems: 0 } });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Failed documents found/);
  assert.match(result.text, /memory agent failed/);
});

test("memory replay plans failed documents by default", async () => {
  const result = await memoryReplay({
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Failed note" }
          ]
        });
      }
      if (url.endsWith("/v3/documents/doc_failed")) {
        return response(200, {
          id: "doc_failed",
          content: "Replay this note",
          containerTags: ["repo"],
          metadata: { source: "test" },
          taskType: "memory"
        });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.planned, 1);
  assert.match(result.text, /dry-run complete/);
});

test("memory replay apply resubmits failed documents", async () => {
  const posts = [];
  const result = await memoryReplay({
    apply: true,
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Failed note" }
          ]
        });
      }
      if (url.endsWith("/v3/documents/doc_failed")) {
        return response(200, {
          id: "doc_failed",
          content: "Replay this note",
          containerTags: ["repo"],
          metadata: { source: "test" },
          taskType: "memory"
        });
      }
      if (url.endsWith("/v3/documents") && init.method === "POST") {
        posts.push(JSON.parse(init.body));
        return response(200, { id: "new_doc", status: "queued" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.replayed, 1);
  assert.equal(posts[0].metadata.smctlReplayFrom, "doc_failed");
});

test("memory replay apply stops when Supermemory Local schema is mismatched", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "error: column \"dreaming_status\" does not exist\n");
  const posts = [];

  const result = await memoryReplay({
    home,
    apply: true,
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Failed note" }
          ]
        });
      }
      if (url.endsWith("/v3/documents") && init?.method === "POST") {
        posts.push(JSON.parse(init.body));
        return response(200, { id: "new_doc", status: "queued" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(posts.length, 0);
  assert.match(result.text, /Supermemory Local schema mismatch/);
});

test("memory replay apply stops when processing API is failing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "");
  const posts = [];

  const result = await memoryReplay({
    home,
    apply: true,
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Failed note" }
          ]
        });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(500, { error: "Internal server error" });
      }
      if (url.endsWith("/v3/documents") && init?.method === "POST") {
        posts.push(JSON.parse(init.body));
        return response(200, { id: "new_doc", status: "queued" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(posts.length, 0);
  assert.match(result.text, /Supermemory processing API is failing/);
});

test("memory doctor fails when processing API is failing", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));

  const result = await memoryDoctor({
    home,
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [] });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(500, { error: "Internal server error" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Supermemory processing API is failing/);
});

test("memory doctor names Supermemory Local schema mismatch", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "error: column \"dreaming_status\" does not exist\n");

  const result = await memoryDoctor({
    home,
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [] });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(500, { error: "Internal server error" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Supermemory Local schema mismatch/);
});

test("memory doctor passes on healthy sample", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-memory-home-"));
  const result = await memoryDoctor({
    home,
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_done", status: "done", title: "Project memory", containerTags: ["repo"] }
          ]
        });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(200, { running: 0, queued: 0 });
      }
      if (url.endsWith("/v4/memories/list")) {
        return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 1 } });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /sampled memory health looks usable/);
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}
