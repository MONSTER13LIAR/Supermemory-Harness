import test from "node:test";
import assert from "node:assert/strict";
import { attachSmartSections, buildSmartSections } from "../src/smart-sections.js";

test("smart sections summarize gate decisions and next action", () => {
  const sections = buildSmartSections({
    command: "gate",
    decision: {
      status: "block",
      label: "Repair memory before relying on it",
      detail: "Blocking memory health issues can mislead the agent."
    },
    score: { value: 25, label: "weak", detail: "failed writes and missing project scope" },
    blockers: [{ status: "fail", title: "Failed memory writes", detail: "1 failed document" }],
    next: "smctl repair wizard",
    exitCode: 1
  });

  assert.equal(sections[0].id, "decision");
  assert.equal(sections[0].status, "block");
  assert.equal(sections.some((section) => section.id === "risks"), true);
  assert.equal(sections.at(-1).next, "smctl repair wizard");
});

test("smart sections summarize dream processing changes", () => {
  const sections = buildSmartSections({
    command: "dreams",
    state: { label: "settled", detail: "2 changes since last snapshot" },
    diff: {
      completed: [{ id: "doc_1" }],
      failed: [{ id: "doc_2" }],
      disappeared: [],
      newDocuments: [],
      changed: []
    },
    next: "smctl repair wizard",
    exitCode: 1
  });

  assert.equal(sections[0].id, "dreams");
  assert.equal(sections[0].status, "attention");
  assert.match(sections[0].detail, /1 completed, 1 failed/);
});

test("attach smart sections asks local llama for section-aware explanation", async () => {
  const result = {
    command: "score",
    text: "Score output",
    score: { value: 91, label: "strong", detail: "healthy recall" },
    issues: [],
    next: ["smctl watch"],
    exitCode: 0
  };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          response: "Works: recall is healthy.\nNeeds attention: none.\nNext: run smctl watch."
        });
      }
    };
  };

  const attached = await attachSmartSections(result, { explain: true, fetch });

  assert.match(attached.text, /Smart Sections:/);
  assert.match(attached.text, /Plain English:/);
  assert.equal(attached.smartSections.length > 0, true);
  assert.match(requests[0].body.prompt, /sections/i);
});
