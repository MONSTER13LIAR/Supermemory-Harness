import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectInit, readProjectProfile } from "../src/project.js";

test("project init detects package and git remote", async () => {
  const home = await mkdtemp(join(tmpdir(), "smctl-project-home-"));
  const repo = await mkdtemp(join(tmpdir(), "smctl-project-repo-"));
  await mkdir(join(repo, ".git"), { recursive: true });
  await writeFile(join(repo, "package.json"), JSON.stringify({ name: "project-alpha" }));
  await writeFile(join(repo, ".git", "config"), [
    `[remote "origin"]`,
    "  url = https://github.com/example/project-alpha.git",
    ""
  ].join("\n"));

  const result = await projectInit({ home, cwd: repo });
  const profile = await readProjectProfile(home);
  const stored = JSON.parse(await readFile(join(home, ".config", "smctl", "projects", "active.json"), "utf8"));

  assert.equal(result.exitCode, 0);
  assert.equal(profile.name, "project-alpha");
  assert.equal(profile.root, repo);
  assert.equal(profile.containerTag, "project:project-alpha");
  assert.equal(profile.gitRemote, "https://github.com/example/project-alpha.git");
  assert.equal(stored.name, "project-alpha");
  assert.match(result.text, /Guard will tag future Supermemory writes/);
});
