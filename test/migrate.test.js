import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateCloud, migrateDoctor, migratePlan, migrateReceipt, migrateReport, migrateReview, migrateRetry, migrateVerify } from "../src/migrate.js";

test("migrate plan holds secrets and failed local documents", async () => {
  const result = await migratePlan({
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, {
          memories: [
            { id: "good", status: "done", title: "Project decision", containerTags: ["project:app"] },
            { id: "secret", status: "done", title: "API key", containerTags: ["project:app"] },
            { id: "failed", status: "failed", title: "Broken ingest", containerTags: ["project:app"] }
          ]
        });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", content: "Use sqlite for local tests", status: "done", containerTags: ["project:app"] });
      }
      if (url.endsWith("/v3/documents/secret")) {
        return response(200, { id: "secret", content: "api_key: super-secret-value", status: "done", containerTags: ["project:app"] });
      }
      if (url.endsWith("/v3/documents/failed")) {
        return response(200, { id: "failed", content: "Half processed note", status: "failed", containerTags: ["project:app"] });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.plan.summary.migratable, 1);
  assert.equal(result.plan.summary.held, 2);
  assert.match(result.text, /Held back/);
  assert.match(result.text, /Readiness:/);
});

test("migrate doctor scores readiness and review explains held items", async () => {
  const fetch = async (url) => {
    if (url.endsWith("/v3/documents/list")) {
      return response(200, {
        memories: [
          { id: "good", status: "done", title: "Project decision", containerTags: ["project:app"] },
          { id: "secret", status: "done", title: "API key", containerTags: ["project:app"] }
        ]
      });
    }
    if (url.endsWith("/v3/documents/good")) {
      return response(200, { id: "good", content: "Use sqlite for local tests", status: "done", containerTags: ["project:app"] });
    }
    if (url.endsWith("/v3/documents/secret")) {
      return response(200, { id: "secret", content: "token: super-secret-value", status: "done", containerTags: ["project:app"] });
    }
    return response(404, { error: "missing" });
  };

  const doctor = await migrateDoctor({ fetch });
  const review = await migrateReview({ fetch });

  assert.equal(doctor.readiness.label, "Mostly ready");
  assert.equal(doctor.plan.summary.risky, 1);
  assert.match(doctor.text, /Possible secrets: 1/);
  assert.match(review.text, /Run with --redact/);
});

test("migrate redaction turns replaceable secrets into safe uploads", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  const uploads = [];
  const result = await migrateCloud({
    home,
    apply: true,
    redact: true,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "secret", status: "done", title: "Debug token", containerTags: ["project:app"] }] });
      }
      if (url.endsWith("/v3/documents/secret")) {
        return response(200, { id: "secret", title: "Debug token", content: "token: super-secret-value", status: "done", containerTags: ["project:app"] });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        uploads.push(JSON.parse(init.body));
        return response(200, { id: "cloud_secret" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.summary.migrated, 1);
  assert.equal(result.actions[0].redacted, true);
  assert.equal(uploads[0].content, "[REDACTED]");
  assert.equal(uploads[0].metadata.smctlRedacted, true);
});

test("migrate cloud dry-run makes no cloud writes", async () => {
  const calls = [];
  const result = await migrateCloud({
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision" }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", content: "Keep local to cloud migration safe", status: "done" });
      }
      return response(500, { error: "cloud should not be called" });
    }
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.summary.migratable, 1);
  assert.equal(calls.some((call) => call.url === "https://api.supermemory.ai/v3/documents"), false);
});

test("migrate cloud apply uploads safe documents and writes receipt", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  const uploads = [];
  const result = await migrateCloud({
    home,
    apply: true,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision", containerTags: ["project:app"] }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, {
          id: "good",
          title: "Decision",
          content: "Use Supermemory Local first, then migrate to cloud",
          status: "done",
          containerTags: ["project:app"]
        });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        uploads.push({ headers: init.headers, body: JSON.parse(init.body) });
        return response(200, { id: "cloud_doc" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.migrated, 1);
  assert.equal(uploads[0].headers.authorization, "Bearer cloud-key");
  assert.equal(uploads[0].body.containerTag, "project:app");
  assert.equal(uploads[0].body.metadata.smctlMigration, true);

  const latest = JSON.parse(await readFile(join(home, ".config", "smctl", "migrations", "latest.json"), "utf8"));
  assert.equal(latest.summary.migrated, 1);
});

test("migrate verify reports missing receipt", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  const result = await migrateVerify({ home, fetch: async () => response(404, {}) });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /No migration receipt found/);
});

test("migrate receipt reads latest receipt", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  await migrateCloud({
    home,
    apply: true,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision" }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", title: "Decision", content: "Recall this after migration", status: "done" });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        return response(200, { id: "cloud_doc" });
      }
      return response(404, { error: "missing" });
    }
  });

  const result = await migrateReceipt({ home, fetch: async () => response(404, {}) });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /1 migrated/);
});

test("migrate retry skips content already migrated in latest receipt", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  let uploads = 0;
  await migrateCloud({
    home,
    apply: true,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision" }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", title: "Decision", content: "Recall this after migration", status: "done" });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        uploads += 1;
        return response(200, { id: "cloud_doc" });
      }
      return response(404, { error: "missing" });
    }
  });

  const retry = await migrateRetry({
    home,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision" }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", title: "Decision", content: "Recall this after migration", status: "done" });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        uploads += 1;
        return response(200, { id: "cloud_doc_again" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(uploads, 1);
  assert.equal(retry.summary.skipped, 1);
  assert.match(retry.text, /Already migrated/);
});

test("migrate report summarizes latest migration receipt", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-migrate-home-"));
  await migrateCloud({
    home,
    apply: true,
    env: { SUPERMEMORY_CLOUD_API_KEY: "cloud-key" },
    fetch: async (url) => {
      if (url.endsWith("/v3/documents/list")) {
        return response(200, { memories: [{ id: "good", status: "done", title: "Decision" }] });
      }
      if (url.endsWith("/v3/documents/good")) {
        return response(200, { id: "good", title: "Decision", content: "Recall this after migration", status: "done" });
      }
      if (url === "https://api.supermemory.ai/v3/documents") {
        return response(200, { id: "cloud_doc" });
      }
      return response(404, { error: "missing" });
    }
  });

  const result = await migrateReport({ home, fetch: async () => response(404, {}) });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /migration report/);
  assert.match(result.text, /Readiness at upload/);
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
