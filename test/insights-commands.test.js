import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCleanup } from "../src/cleanup.js";
import { runMemoryCoach } from "../src/coach.js";
import { runProject } from "../src/project.js";
import { runRepairWizard } from "../src/repair.js";
import { runScore } from "../src/score.js";
import { runTimeline } from "../src/timeline.js";

test("insight commands surface memory score, cleanup, coach, timeline, project, and wizard", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-insights-home-"));
  await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
  await mkdir(join(home, ".supermemory", "data"), { recursive: true });
  await writeFile(join(home, ".supermemory", "data", "data"), "x");
  await writeFile(join(home, ".supermemory", "server.log"), "Permanently failed doc_bad: no retry params\n");
  await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
    version: 1,
    id: "demo",
    name: "demo",
    root: "/tmp/demo",
    containerTag: "project:demo"
  }));

  const fetch = fakeFetch();

  const score = await runScore({ home, fetch });
  assert.equal(score.exitCode, 1);
  assert.match(score.text, /Memory Recall Score/);
  assert.match(score.text, /Failed memory writes/);
  assert.match(score.text, /Contradictory project memories/);
  assert.match(score.text, /Smart Sections:/);
  assert.equal(score.smartSections.some((section) => section.id === "score"), true);

  const cleanup = await runCleanup({ home, fetch });
  assert.equal(cleanup.exitCode, 1);
  assert.match(cleanup.text, /Possible secrets: 1/);
  assert.match(cleanup.text, /Mode: plan only/);

  const coach = await runMemoryCoach({ home, fetch });
  assert.match(coach.text, /Improve next/);
  assert.match(coach.text, /Fix failed writes/);

  const timeline = await runTimeline({ home, fetch });
  assert.match(timeline.text, /Recent write activity/);
  assert.match(timeline.text, /project:demo/);

  const project = await runProject({ action: "dashboard", home, fetch });
  assert.equal(project.exitCode, 0);
  assert.match(project.text, /Active project/);
  assert.match(project.text, /project:demo/);

  const wizard = await runRepairWizard({ home, fetch });
  assert.equal(wizard.exitCode, 1);
  assert.match(wizard.text, /Do this in order/);
  assert.match(wizard.text, /smctl memory replay/);
});

function fakeFetch() {
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return async (url) => {
    if (url.endsWith("/v3/documents/list")) {
      return response(200, {
        memories: [
          { id: "doc_bad", status: "failed", title: "Bad import", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_secret", status: "done", title: "api_key = sk-testsecret1234567890", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_dup_1", status: "done", title: "Same decision", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_dup_2", status: "done", title: "Same decision", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_fact_1", status: "done", title: "test runner is Vitest", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_fact_2", status: "done", title: "test runner is Jest", updatedAt: old, containerTags: ["project:demo"] },
          { id: "doc_vague", status: "done", title: "note", updatedAt: old, containerTags: ["other"] }
        ]
      });
    }
    if (url.endsWith("/v3/documents/processing")) {
      return response(200, { queued: 0, running: 0 });
    }
    if (url.endsWith("/v4/memories/list")) {
      return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 1 } });
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
