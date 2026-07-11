import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applySkillsetToRequest, readActiveSkillset, runSkillset } from "../src/skillset.js";

test("skillset install writes active local policy", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skillset-home-"));
  const install = await runSkillset({ home, action: "install", name: "developer" });
  const active = await readActiveSkillset(home);

  assert.equal(install.exitCode, 0);
  assert.equal(active.name, "developer");
  assert.match(install.text, /Developer/);
});

test("skillset doctor fails without active skillset", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skillset-home-"));
  const result = await runSkillset({ home, action: "doctor" });

  assert.equal(result.exitCode, 1);
  assert.match(result.text, /No active skillset/);
});

test("developer skillset classifies memory locally", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skillset-home-"));
  await runSkillset({ home, action: "install", name: "developer" });
  const active = await readActiveSkillset(home);
  const result = applySkillsetToRequest(active, {
    body: {
      content: "Architecture decision: use SQLite for local cache.",
      containerTag: "repo"
    }
  });

  assert.equal(result.metadata.smctlSkillset, "developer");
  assert.equal(result.metadata.smctlMemoryType, "architecture_decision");
});
