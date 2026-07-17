import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectInit } from "../src/project.js";
import { runVerify } from "../src/verify.js";

test("verify proves project scoped write, recall, and language probe", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-verify-home-"));
  const repo = await mkdtemp(join(tmpdir(), "smctl-verify-repo-"));
  await mkdir(join(repo, ".git"), { recursive: true });
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "verify-project" }));
  await projectInit({ home, cwd: repo });

  const documents = new Map();
  let counter = 0;
  const result = await runVerify({
    home,
    cwd: repo,
    marker: "smctl_verify_marker",
    languageMarker: "PHYSALIS-VERIFY",
    sleep: async () => {},
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents") && init.method === "POST") {
        counter += 1;
        const body = JSON.parse(init.body);
        const id = `doc_${counter}`;
        documents.set(id, { id, status: "done", ...body });
        return response(200, { id, status: "queued" });
      }
      const docMatch = url.match(/\/v3\/documents\/([^/]+)$/);
      if (docMatch) {
        return response(200, documents.get(docMatch[1]) ?? { id: docMatch[1], status: "failed" });
      }
      if (url.endsWith("/v3/search")) {
        return response(200, { total: 0, results: [] });
      }
      if (url.endsWith("/v4/search")) {
        const body = JSON.parse(init.body);
        const terms = String(body.q).toLowerCase().split(/\s+/).filter(Boolean);
        const found = [...documents.values()].filter((doc) => {
          const sameContainer = !body.containerTag || doc.containerTag === body.containerTag;
          const content = doc.content.toLowerCase();
          return sameContainer && (doc.content.includes(body.q) || terms.every((term) => content.includes(term)));
        });
        return response(200, { total: found.length, results: found });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.containerTag, "project:verify-project");
  assert.equal(result.canaries.every((canary) => canary.passed), true);
  assert.match(result.text, /Recall canary suite/);
  assert.match(result.text, /Language recall probe/);
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
