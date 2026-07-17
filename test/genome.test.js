import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyGenomePolicyToRequest, readGenomePolicy, runGenome } from "../src/genome.js";

test("genome classifies stored memories and generates a developer policy", async () => {
  const home = await fakeHome();
  const result = await runGenome({
    home,
    fetch: fakeFetch,
    limit: 20
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.mode.id, "developer");
  assert.equal(result.policyState, "not-installed");
  assert.equal(result.policy.defaultContainerTag, "project:harness");
  assert.equal(result.categories.some((item) => item.id === "project_decisions" && item.count > 0), true);
  assert.equal(result.categories.some((item) => item.id === "coding_conventions" && item.count > 0), true);
  assert.equal(result.next[0], "smctl genome apply");
  assert.match(result.text, /Memory Genome/);
  assert.match(result.text, /Generated policy/);
  assert.match(result.text, /Developer memory/);
  assert.match(result.text, /Smart Sections:/);
});

test("genome apply installs a local policy that can personalize Guard", async () => {
  const home = await fakeHome();
  const applied = await runGenome({
    home,
    fetch: fakeFetch,
    action: "apply",
    limit: 20
  });
  const policy = await readGenomePolicy(home);
  const request = {
    body: {
      content: "Architecture decision: use Node test runner for unit tests."
    }
  };
  const personalization = applyGenomePolicyToRequest(policy, request);

  assert.equal(applied.applied, true);
  assert.equal(applied.policyState, "installed");
  assert.equal(policy.mode, "developer");
  assert.equal(personalization.metadata.smctlGenomeMode, "developer");
  assert.equal(personalization.metadata.smctlGenomeType, "architecture_decision");
  assert.equal(personalization.containerTag, "project:harness");
  assert.match(applied.text, /policy installed/);
});

test("genome blocks when the memory inventory cannot be read", async () => {
  const home = await fakeHome();
  const result = await runGenome({
    home,
    fetch: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.reachable, false);
  assert.match(result.text, /Memory inventory unavailable/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-genome-home-"));
  await mkdir(join(home, ".config", "smctl", "projects"), { recursive: true });
  await writeFile(join(home, ".config", "smctl", "projects", "active.json"), JSON.stringify({
    version: 1,
    id: "harness",
    name: "Supermemory Harness",
    root: home,
    containerTag: "project:harness"
  }));
  await mkdir(join(home, ".supermemory"), { recursive: true });
  await writeFile(join(home, ".supermemory", "server.log"), "");
  return home;
}

async function fakeFetch(url) {
  const path = new URL(url).pathname;
  if (path === "/v3/documents/list") {
    return response(200, {
      memories: [
        doc("doc_1", "Architecture decision: use Node test runner", "Decision: use Node test runner for the dependency-free Harness CLI.", "/repo/package.json"),
        doc("doc_2", "Bug fix: replay guard blocks broken runtime", "Fix: memory replay refuses writes when Supermemory processing returns HTTP 500.", "/repo/src/memory.js"),
        doc("doc_3", "Repo convention: use apply_patch for edits", "Convention: contributors use apply_patch for manual edits and keep plan.md local only.", "/repo/README.md"),
        doc("doc_4", "Repeated failure: schema mismatch blocks dreams", "Failed attempt: dreaming_job schema mismatch caused repeated local runtime failures.", "/repo/logs.md")
      ]
    });
  }
  if (path === "/v3/documents/processing") {
    return response(200, { running: 0, queued: 0 });
  }
  if (path === "/v4/memories/list") {
    return response(200, { memoryEntries: [{ id: "mem_1" }], pagination: { totalItems: 4 } });
  }
  if (path === "/v4/profile") {
    return response(200, {
      profile: {
        static: ["User prefers dependency-free Node CLIs"],
        dynamic: ["Working on Supermemory Harness"],
        buckets: {
          engineering: { facts: ["Uses source-grounded memories"] }
        }
      }
    });
  }
  return response(404, { error: "missing" });
}

function doc(id, title, content, filepath) {
  return {
    id,
    title,
    content,
    filepath,
    status: "done",
    containerTags: ["project:harness"],
    updatedAt: new Date().toISOString()
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
