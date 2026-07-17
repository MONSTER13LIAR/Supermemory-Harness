import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRepair, runRepairWizard } from "../src/repair.js";

test("repair plans around failed docs, stale queue, logs, and store growth", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-repair-home-"));
  await mkdir(join(home, ".supermemory", "data"), { recursive: true });
  await writeFile(join(home, ".supermemory", "data", "data"), "x");
  await writeFile(join(home, ".supermemory", "server.log"), [
    "[Cron] Marked doc_failed as terminally failed: No retry params on disk",
    "[NODE-CRON] missed execution because high CPU"
  ].join("\n"));

  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = await runRepair({
    home,
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "doc_failed", status: "failed", title: "Bad import", containerTags: ["repo"] },
            { id: "doc_stale", status: "queued", title: "Stale import", updatedAt: old, containerTags: ["repo"] },
            { id: "doc_done", status: "done", title: "Done import", containerTags: ["repo"] }
          ]
        });
      }
      if (url.endsWith("/v3/documents/processing")) {
        return response(200, { queued: 1, running: 0 });
      }
      if (url.endsWith("/v4/memories/list")) {
        return response(200, { memoryEntries: [], pagination: { totalItems: 0 } });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Failed documents found/);
  assert.match(result.text, /Stale queued documents found/);
  assert.match(result.text, /Safest next steps/);
  assert(result.actions.some((action) => action.kind === "replay"));
});

test("repair and wizard prioritize Supermemory Local schema mismatch before replay", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-repair-home-"));
  await mkdir(join(home, ".supermemory", "data"), { recursive: true });
  await writeFile(join(home, ".supermemory", "data", "data"), "x");
  await writeFile(join(home, ".supermemory", "server.log"), [
    "error: column \"dreaming_status\" does not exist",
    "error: Failed query: select \"dreaming_status\" from \"document\""
  ].join("\n"));

  const fetch = async (url) => {
    if (url.endsWith("/v3/documents/list")) {
      return response(200, {
        memories: [
          { id: "doc_failed", status: "failed", title: "Bad import", containerTags: ["repo"] }
        ]
      });
    }
    if (url.endsWith("/v3/documents/processing")) {
      return response(500, { error: "Internal server error" });
    }
    if (url.endsWith("/v4/memories/list")) {
      return response(200, { memoryEntries: [], pagination: { totalItems: 0 } });
    }
    return response(404, { error: "missing" });
  };

  const repair = await runRepair({ home, fetch });
  assert.equal(repair.exitCode, 1);
  assert.match(repair.text, /Supermemory Local schema mismatch/);
  assert(repair.actions.some((action) => action.kind === "schema"));

  const wizard = await runRepairWizard({ home, fetch });
  assert.equal(wizard.steps[0].title, "Fix Supermemory Local schema");
  assert.doesNotMatch(wizard.text, /smctl memory replay --apply/);
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
