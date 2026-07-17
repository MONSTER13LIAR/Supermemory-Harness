import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const EXCLUDED_SECRET_FILES = ["api-key", "auth-secret", "env.enc"];

export async function runBackup(options = {}) {
  const context = {
    home: options.home ?? homedir(),
    dryRun: Boolean(options.dryRun),
    now: options.now ?? new Date().toISOString()
  };
  const store = options.store ?? join(context.home, ".supermemory");
  const destination = backupPath(context.home, context.now);
  const inventory = await inspectStore(store, context.home);
  const manifest = {
    command: "backup",
    generatedAt: context.now,
    mode: context.dryRun ? "dry-run" : "create",
    source: redactHome(store, context.home),
    destination: redactHome(destination, context.home),
    inventory,
    excluded: EXCLUDED_SECRET_FILES.map((name) => redactHome(join(store, name), context.home)),
    warning: "Backup excludes Supermemory API key, auth secret, and encrypted provider env by default."
  };

  if (!context.dryRun && inventory.exists) {
    await mkdir(destination, { recursive: true });
    await copyIfExists(join(store, "data"), join(destination, "data"));
    await copyIfExists(join(store, "runtime"), join(destination, "runtime"));
    await copyIfExists(join(store, "server.log"), join(destination, "server.log"));
    await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }

  const result = {
    ...manifest,
    path: manifest.destination,
    exitCode: inventory.exists ? 0 : 1
  };
  result.text = formatBackup(result);
  return result;
}

async function inspectStore(store, home) {
  const exists = await pathExists(store);
  if (!exists) {
    return {
      exists: false,
      sizeBytes: 0,
      files: [],
      warnings: [`${redactHome(store, home)} does not exist`]
    };
  }

  const data = await inspectPath(join(store, "data"), home);
  const runtime = await inspectPath(join(store, "runtime"), home);
  const log = await inspectPath(join(store, "server.log"), home);
  const secretPresence = [];
  for (const name of EXCLUDED_SECRET_FILES) {
    if (await pathExists(join(store, name))) secretPresence.push(name);
  }
  const files = [data, runtime, log].filter((item) => item.exists);
  const sizeBytes = files.reduce((sum, item) => sum + item.sizeBytes, 0);
  const warnings = [];
  if (!data.exists) warnings.push("No data path found; backup may not contain memory store state.");
  if (secretPresence.length > 0) warnings.push(`Excluded secret/config file(s): ${secretPresence.join(", ")}`);
  return {
    exists: true,
    sizeBytes,
    files,
    warnings
  };
}

async function inspectPath(path, home) {
  if (!await pathExists(path)) {
    return {
      path: redactHome(path, home),
      exists: false,
      sizeBytes: 0
    };
  }
  const sizeBytes = await sizeOf(path);
  return {
    path: redactHome(path, home),
    exists: true,
    sizeBytes
  };
}

async function sizeOf(path) {
  const info = await stat(path);
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await sizeOf(join(path, entry.name));
  }
  return total;
}

async function copyIfExists(source, destination) {
  if (!await pathExists(source)) return;
  await cp(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function formatBackup(result) {
  const lines = [];
  lines.push("Supermemory Harness backup");
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Source: ${result.source}`);
  lines.push(`Destination: ${result.destination}`);
  lines.push(`Size: ${formatBytes(result.inventory.sizeBytes)}`);
  lines.push("");
  if (!result.inventory.exists) {
    lines.push("[fail] Supermemory Local store missing");
  } else {
    lines.push("[ok] Data-only backup plan ready");
    for (const file of result.inventory.files) {
      lines.push(`   ${file.path}  ${formatBytes(file.sizeBytes)}`);
    }
  }
  if (result.inventory.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.inventory.warnings) lines.push(`   ${warning}`);
  }
  lines.push("");
  lines.push("Excluded secrets:");
  for (const item of result.excluded) lines.push(`   ${item}`);
  lines.push("");
  lines.push(result.mode === "dry-run"
    ? "Result: dry-run only; no backup written."
    : result.exitCode === 0
      ? "Result: backup written. Keep it local unless you intentionally review it first."
      : "Result: backup not written.");
  return lines.join("\n");
}

function backupPath(home, now) {
  const stamp = now.replace(/[:.]/g, "-");
  return join(home, ".config", "smctl", "backups", stamp);
}

function redactHome(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(1)} MiB`;
  const kib = bytes / 1024;
  if (kib >= 1) return `${kib.toFixed(1)} KiB`;
  return `${bytes} B`;
}
