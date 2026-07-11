import test from "node:test";
import assert from "node:assert/strict";
import { runSmoke } from "../src/smoke.js";

test("smoke succeeds when document reaches done and search returns marker", async () => {
  const calls = [];
  const result = await runSmoke({
    marker: "smctl_test_marker",
    sleep: async () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v3/documents") && init.method === "POST") {
        return response(200, { id: "doc_123", status: "queued" });
      }
      if (url.endsWith("/v3/documents/doc_123")) {
        return response(200, { id: "doc_123", status: "done" });
      }
      if (url.endsWith("/v3/search")) {
        return response(200, { total: 1, results: [{ content: "smctl_test_marker" }] });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.searchTotal, 1);
  assert(calls.some((call) => call.url.endsWith("/v3/search")));
});

test("smoke fails when document processing fails", async () => {
  const result = await runSmoke({
    marker: "smctl_failed_marker",
    sleep: async () => {},
    fetch: async (url, init) => {
      if (url.endsWith("/v3/documents") && init.method === "POST") {
        return response(200, { id: "doc_failed", status: "queued" });
      }
      if (url.endsWith("/v3/documents/doc_failed")) {
        return response(200, { id: "doc_failed", status: "failed" });
      }
      return response(404, { error: "missing" });
    }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /Document processing did not complete/);
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
