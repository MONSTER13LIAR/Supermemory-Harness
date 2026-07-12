import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillsDoctor, skillsInstall, skillsList } from "../src/skills.js";

test("skills install writes all markdown skills", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skills-home-"));

  const result = await skillsInstall({ home });
  const hygiene = await readFile(join(home, ".config", "smctl", "skills", "memory-write-hygiene.md"), "utf8");
  const query = await readFile(join(home, ".config", "smctl", "skills", "memory-query-patterns.md"), "utf8");
  const context = await readFile(join(home, ".config", "smctl", "skills", "context-injection-format.md"), "utf8");
  const health = await readFile(join(home, ".config", "smctl", "skills", "memory-health-triage.md"), "utf8");
  const personalization = await readFile(join(home, ".config", "smctl", "skills", "project-memory-personalization.md"), "utf8");
  const conflict = await readFile(join(home, ".config", "smctl", "skills", "memory-conflict-resolution.md"), "utf8");

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.created, 6);
  assert.match(hygiene, /Search for related existing memories/);
  assert.match(query, /Query Supermemory before asking/);
  assert.match(context, /Do not dump raw JSON/);
  assert.match(health, /Inspect failed documents/);
  assert.match(personalization, /Classify the app domain/);
  assert.match(conflict, /Do not silently pick/);
});

test("skills doctor reports installed skills", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skills-home-"));
  await skillsInstall({ home });

  const result = await skillsDoctor({ home });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.ok, 6);
});

test("skills list marks installed skills", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-skills-home-"));
  await skillsInstall({ home, name: "memory-write-hygiene" });

  const result = await skillsList({ home });
  const hygiene = result.skills.find((skill) => skill.name === "memory-write-hygiene");
  const query = result.skills.find((skill) => skill.name === "memory-query-patterns");

  assert.equal(hygiene.installed, true);
  assert.equal(query.installed, false);
});
