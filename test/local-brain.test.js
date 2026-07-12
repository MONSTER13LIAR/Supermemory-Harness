import test from "node:test";
import assert from "node:assert/strict";
import { appendExplanation, explainHarnessResult, localBrainDoctor } from "../src/local-brain.js";

test("local brain explains harness results through Ollama", async () => {
  const result = await explainHarnessResult({
    command: "status",
    summary: { ok: 2, warn: 2, fail: 0 },
    sections: [{ title: "Memory Health", status: "warn", detail: "2 fail, 2 warn" }],
    next: ["smctl repair"],
    exitCode: 0
  }, {
    fetch: async (url, init) => {
      assert(url.endsWith("/api/generate"));
      const body = JSON.parse(init.body);
      assert.equal(body.model, "llama3.2:1b-instruct-q4_K_M");
      return response(200, {
        response: "Works: Supermemory is running.\nNeeds attention: memory processing needs attention.\nNext: run smctl repair."
      });
    }
  });

  assert.equal(result.available, true);
  assert.match(result.text, /Supermemory is running/);
});

test("local brain falls back when model ignores the required shape", async () => {
  const result = await explainHarnessResult({
    command: "status",
    summary: { ok: 2, warn: 2, fail: 0 },
    sections: [
      { title: "Supermemory Local", status: "ok", detail: "20 checks passed" },
      { title: "Memory Health", status: "warn", detail: "2 fail, 2 warn" },
      { title: "Repair Watchdog", status: "warn", detail: "2 fail, 0 warn" },
      { title: "Guard Inbox", status: "ok", detail: "0 pending writes" }
    ],
    next: ["smctl memory doctor", "smctl memory replay", "smctl repair"],
    exitCode: 0
  }, {
    fetch: async () => response(200, {
      response: "Here are three lines explaining the result but not in the requested format."
    })
  });

  assert.equal(result.available, true);
  assert.match(result.text, /Works: Supermemory Local, Guard Inbox/);
  assert.match(result.text, /Needs attention: Memory Health/);
  assert.match(result.text, /Next: run smctl repair/);
});

test("local brain doctor reports installed model", async () => {
  const result = await localBrainDoctor({
    fetch: async (url) => {
      assert(url.endsWith("/api/tags"));
      return response(200, {
        models: [{ name: "llama3.2:1b-instruct-q4_K_M" }]
      });
    }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Local Llama is ready/);
});

test("appendExplanation includes fallback detail", () => {
  const text = appendExplanation("Base output", {
    available: false,
    detail: "Ollama timed out"
  });
  assert.match(text, /Plain English/);
  assert.match(text, /Ollama timed out/);
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
