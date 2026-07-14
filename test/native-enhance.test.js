import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runNativeEnhance } from "../src/native-enhance.js";

test("native enhance patches Supermemory Desktop source", async () => {
  const sourceRoot = await fakeSupermemorySource();
  const result = await runNativeEnhance({
    cwd: sourceRoot,
    home: sourceRoot,
    dryRun: false
  });

  assert.equal(result.status, "ready");
  assert.equal(result.summary.updated, 2);

  const page = await readFile(join(sourceRoot, "apps", "desktop", "app", "(app)", "page.tsx"), "utf8");
  const tools = await readFile(join(sourceRoot, "apps", "desktop", "src-tauri", "src", "tools.rs"), "utf8");

  assert.match(page, /Agent memory/);
  assert.match(page, /detectDesktopTools/);
  assert.match(page, /connectDesktopTool/);
  assert.match(tools, /DEFAULT_LOCAL_MCP_URL: &str = "http:\/\/localhost:6767\/mcp"/);
  assert.match(tools, /fn mcp_url\(\) -> String/);
  assert.doesNotMatch(tools, /https:\/\/mcp\.supermemory\.ai\/mcp/);
});

test("native enhance is idempotent", async () => {
  const sourceRoot = await fakeSupermemorySource();
  await runNativeEnhance({ cwd: sourceRoot, home: sourceRoot });
  const result = await runNativeEnhance({ cwd: sourceRoot, home: sourceRoot });

  assert.equal(result.summary.unchanged, 2);
  assert.equal(result.summary.updated, 0);
});

test("native enhance dry-run reports changes without writing", async () => {
  const sourceRoot = await fakeSupermemorySource();
  const result = await runNativeEnhance({
    cwd: sourceRoot,
    home: sourceRoot,
    dryRun: true
  });
  const page = await readFile(join(sourceRoot, "apps", "desktop", "app", "(app)", "page.tsx"), "utf8");

  assert.equal(result.summary["would-update"], 2);
  assert.doesNotMatch(page, /Agent memory/);
});

async function fakeSupermemorySource() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "smctl-native-source-"));
  const pagePath = join(sourceRoot, "apps", "desktop", "app", "(app)");
  const toolsPath = join(sourceRoot, "apps", "desktop", "src-tauri", "src");
  await mkdir(pagePath, { recursive: true });
  await mkdir(toolsPath, { recursive: true });
  await writeFile(join(pagePath, "page.tsx"), pageSource());
  await writeFile(join(toolsPath, "tools.rs"), toolsSource());
  return sourceRoot;
}

function pageSource() {
  return `"use client"

import { useQuery } from "@tanstack/react-query"
import {
\tArrowRight,
\tClock,
\tFileText,
\tLink2,
\tLightbulb,
\tLoader2,
\tPlus,
\tRefreshCcw,
\tSearch,
\tSendHorizontal,
\tSparkles,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { listDocuments, type DocumentWithMemories } from "@/lib/api"
import type { SearchResult } from "@/lib/search"
import { OPEN_MEMORY_EVENT, type SpotlightMemory } from "@/lib/spotlight"
import { SearchCommand, useCommandK } from "@/components/search-command"

type MemoryPreview = { id: string; title: string | null; createdAt: string | Date }

export default function DashboardPage() {
\tconst { open, setOpen } = useCommandK()
\tconst [selectedMemory, setSelectedMemory] = useState<MemoryPreview | null>(
\t\tnull,
\t)
\tconst documentsQuery = useQuery({
\t\tqueryKey: ["desktop-documents"],
\t\tqueryFn: listDocuments,
\t\tstaleTime: 60 * 1000,
\t})
\tconst documents = documentsQuery.data?.documents ?? []
\tconst activeMemory =
\t\tselectedMemory ?? toMemoryPreview(documents.at(0) ?? null)
\tconst totalCount = documentsQuery.data?.pagination.totalItems
\tconst subtitle = useMemo(() => {
\t\tif (documentsQuery.isPending) return "Loading your recent memories."
\t\tif (typeof totalCount === "number") return \`\${totalCount} memories indexed.\`
\t\treturn "Your memory is ready."
\t}, [documentsQuery.isPending, totalCount])
\tconst visibleDocuments = documents.slice(0, 5)

\tuseEffect(() => {}, [])

\treturn (
\t\t<div>
\t\t\t<section>
\t\t\t\t\t<div>
\t\t\t\t\t</div>
\t\t\t\t\t<section className="mx-auto w-full max-w-2xl space-y-2">
\t\t\t\t\t\tRecents {visibleDocuments.length} {activeMemory?.title}
\t\t\t\t\t</section>
\t\t\t</section>
\t\t\t<SearchCommand open={open} onOpenChange={setOpen} onOpenResult={() => {}} />
\t\t</div>
\t)
}

function ComposerAction({ icon: Icon, label }: { icon: typeof Link2; label: string }) {
\treturn <button><Icon />{label}</button>
}

function RecentMemoryRow({
\tdocument,
}: {
\tdocument: DocumentWithMemories
}) {
\treturn <li>{document.title}</li>
}

function toMemoryPreview(document: DocumentWithMemories | null): MemoryPreview | null {
\treturn document ? { id: document.id, title: document.title, createdAt: document.createdAt } : null
}
`;
}

function toolsSource() {
  return `use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::json;

const MCP_URL: &str = "https://mcp.supermemory.ai/mcp";

fn connect_json() {
    let _server = json!({ "url": MCP_URL });
}

fn connect_codex_toml() {
    let mut args = Vec::new();
    args.push(MCP_URL);
}

fn write_config_atomically(path: &Path, bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    let _ = (path, bytes);
    Ok(None)
}
`;
}
