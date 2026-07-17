import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEvidence } from "../src/evidence.js";

const NOW = "2026-07-17T12:34:56.789Z";
const STAMP = "2026-07-17T12-34-56-789Z.md";
const SECRET = `sm_${"s".repeat(32)}`;

test("evidence pack writes a redacted judge-ready report even when Local is offline", async () => {
  const home = await fakeHome();
  const result = await runEvidence({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: offlineFetch,
    limit: 3,
    now: NOW
  });

  const reportPath = join(home, ".config", "smctl", "evidence", STAMP);
  const written = await readFile(reportPath, "utf8");

  assert.equal(result.exitCode, 1);
  assert.equal(result.path, `~/.config/smctl/evidence/${STAMP}`);
  assert.match(result.text, /Supermemory Harness evidence pack/);
  assert.match(result.text, /Why This Should Win:/);
  assert.match(result.text, /Demo Commands:/);
  assert.match(result.text, /Architecture Evidence:/);
  assert.match(result.text, /Recommended next command: smctl supermemory start/);
  assert.doesNotMatch(result.text, new RegExp(SECRET));
  assert.doesNotMatch(result.text, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(written, new RegExp(SECRET));
  assert.doesNotMatch(written, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("evidence dry-run returns the target path without writing a file", async () => {
  const home = await fakeHome();
  const result = await runEvidence({
    home,
    cwd: home,
    env: { PATH: "" },
    fetch: offlineFetch,
    limit: 1,
    dryRun: true,
    now: NOW
  });

  const reportPath = join(home, ".config", "smctl", "evidence", STAMP);
  await assert.rejects(access(reportPath));
  assert.equal(result.path, `~/.config/smctl/evidence/${STAMP}`);
  assert.match(result.text, /Dry run: no evidence file was written/);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-evidence-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "bin"), { recursive: true });
  await writeFile(join(store, "bin", "supermemory-server"), "");
  await writeFile(join(store, "api-key"), `${SECRET}\n`);
  await writeFile(join(store, "server.log"), "");
  return home;
}

async function offlineFetch() {
  throw new Error(`connect ECONNREFUSED ${SECRET}`);
}
