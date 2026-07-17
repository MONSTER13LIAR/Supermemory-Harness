import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBackup } from "../src/backup.js";

test("backup creates data-only copy and excludes secrets", async () => {
  const home = await fakeHome();
  const result = await runBackup({
    home,
    now: "2026-07-17T12:00:00.000Z"
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /Data-only backup/);
  assert.match(result.text, /Excluded secrets/);
  assert.equal(result.path, "~/.config/smctl/backups/2026-07-17T12-00-00-000Z");

  const backupRoot = join(home, ".config", "smctl", "backups", "2026-07-17T12-00-00-000Z");
  assert.equal(await exists(join(backupRoot, "data", "data")), true);
  assert.equal(await exists(join(backupRoot, "runtime", "state.db")), true);
  assert.equal(await exists(join(backupRoot, "api-key")), false);
  assert.equal(await exists(join(backupRoot, "auth-secret")), false);

  const manifest = JSON.parse(await readFile(join(backupRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.excluded.some((item) => item.includes("api-key")), true);
});

test("backup dry-run writes nothing", async () => {
  const home = await fakeHome();
  const result = await runBackup({
    home,
    dryRun: true,
    now: "2026-07-17T12:00:00.000Z"
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.text, /dry-run only/);
  assert.equal(await exists(join(home, ".config", "smctl", "backups", "2026-07-17T12-00-00-000Z")), false);
});

async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "smctl-backup-home-"));
  const store = join(home, ".supermemory");
  await mkdir(join(store, "data"), { recursive: true });
  await mkdir(join(store, "runtime"), { recursive: true });
  await writeFile(join(store, "data", "data"), "memory-store");
  await writeFile(join(store, "runtime", "state.db"), "runtime-state");
  await writeFile(join(store, "server.log"), "server log");
  await writeFile(join(store, "api-key"), `sm_${"a".repeat(87)}\n`);
  await writeFile(join(store, "auth-secret"), "secret-value\n");
  await writeFile(join(store, "env.enc"), "encrypted\n");
  return home;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
