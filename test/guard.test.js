import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { guardContext, quarantineWrite, runGuard } from "../src/guard.js";
import { projectInit } from "../src/project.js";
import { runSkillset } from "../src/skillset.js";

test("guard quarantines document writes and lists inbox", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  const context = guardContext({ home });
  const item = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: {
        content: "Remember that this project always uses safe migrations.",
        containerTag: "repo"
    },
    rawBody: JSON.stringify({
      content: "Remember that this project always uses safe migrations.",
      containerTag: "repo"
    })
  });

  assert.equal(item.risk.level, "medium");
  const inbox = await runGuard({ home, action: "inbox" });
  assert.equal(inbox.pending.length, 1);
  assert.match(inbox.text, /Instruction-like memory content detected/);
});

test("guard approve forwards stored write and removes it from inbox", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  const context = guardContext({ home });
  const forwarded = [];
  const fetchMock = async (url, init) => {
    forwarded.push({ url, init });
    return response(200, { id: "upstream_doc", status: "queued" });
  };

  const write = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: { content: "Normal project note", containerTag: "repo" },
    rawBody: JSON.stringify({ content: "Normal project note", containerTag: "repo" })
  });

  const approved = await runGuard({ home, action: "approve", id: write.id, fetch: fetchMock });
  const inbox = await runGuard({ home, action: "inbox" });

  assert.equal(approved.exitCode, 0);
  assert.equal(forwarded.length, 1);
  assert.equal(inbox.pending.length, 0);
});

test("guard redacts detected secrets before storing or forwarding writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  const context = guardContext({ home });
  const secret = "sk-testsecretvalue1234567890";
  const item = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: {
      content: `Remember the key is ${secret}`,
      metadata: {
        note: `OPENAI_API_KEY=${secret}`
      }
    },
    rawBody: JSON.stringify({ content: `Remember the key is ${secret}` })
  });

  assert.equal(item.risk.level, "high");
  assert.match(item.request.body.content, /\[REDACTED\]/);
  assert.match(item.request.body.metadata.note, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(item), new RegExp(secret));

  const forwarded = [];
  const approved = await runGuard({
    home,
    action: "approve",
    id: item.id,
    fetch: async (url, init) => {
      forwarded.push({ url, init });
      return response(200, { id: "upstream_doc", status: "queued" });
    }
  });

  assert.equal(approved.exitCode, 0);
  assert.doesNotMatch(forwarded[0].init.body, new RegExp(secret));
  assert.match(forwarded[0].init.body, /\[REDACTED\]/);
});

test("guard detects common untagged credential shapes", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  const context = guardContext({ home });
  const slackToken = ["xoxb", "123456789012", "abcdefghijklmnop"].join("-");
  const item = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: {
      content: `Debug log included SLACK_BOT_TOKEN=${slackToken}`
    },
    rawBody: "{}"
  });

  assert.equal(item.risk.level, "high");
  assert.match(item.request.body.content, /\[REDACTED\]/);
});

test("guard applies active skillset metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  await runSkillset({ home, action: "install", name: "developer" });
  const context = guardContext({ home });

  const item = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: { content: "Architecture decision: use Vitest for unit tests." },
    rawBody: JSON.stringify({ content: "Architecture decision: use Vitest for unit tests." })
  });

  assert.equal(item.skillset.name, "developer");
  assert.equal(item.request.body.metadata.smctlSkillset, "developer");
  assert.equal(item.request.body.metadata.smctlMemoryType, "architecture_decision");
});

test("guard applies active project profile metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-guard-home-"));
  const repo = await mkdtemp(join(tmpdir(), "smctl-guard-repo-"));
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "client-portal" }));
  await projectInit({ home, cwd: repo, name: "Client Portal" });
  const context = guardContext({ home });

  const item = await quarantineWrite(context, {
    method: "POST",
    path: "/v3/documents",
    query: "",
    headers: { "content-type": "application/json" },
    body: { content: "Remember the billing export decision." },
    rawBody: JSON.stringify({ content: "Remember the billing export decision." })
  });

  assert.equal(item.project.name, "Client Portal");
  assert.equal(item.request.body.containerTag, "project:client-portal");
  assert.equal(item.request.body.metadata.smctlProject, "Client Portal");
  assert.equal(item.request.body.metadata.smctlProjectRoot, repo);
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
