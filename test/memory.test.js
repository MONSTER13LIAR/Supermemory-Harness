import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { memoryDoctor } from "../src/memory.js";

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
