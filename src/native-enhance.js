import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const PAGE_PATH = join("apps", "desktop", "app", "(app)", "page.tsx");
const TOOLS_PATH = join("apps", "desktop", "src-tauri", "src", "tools.rs");
const MCP_CLIENT_PATH = join("apps", "mcp", "src", "client.ts");
const MCP_SERVER_PATH = join("apps", "mcp", "src", "server.ts");
const OPENAI_MIDDLEWARE_PATH = join("packages", "tools", "src", "openai", "middleware.ts");

export async function runNativeEnhance(options = {}) {
  const context = {
    cwd: options.cwd ?? process.cwd(),
    home: options.home ?? homedir(),
    sourcePath: options.sourcePath ?? null,
    dryRun: Boolean(options.dryRun)
  };
  const sourceRoot = await findSourceRoot(context);
  if (!sourceRoot) {
    return result({
      status: "skipped",
      sourceRoot: null,
      actions: [{
        status: "skipped",
        title: "Find Supermemory Desktop source",
        detail: "No compatible source checkout found. Harness will use the embedded dashboard path."
      }]
    });
  }

  const actions = [];
  actions.push(await patchDesktopPage(sourceRoot, context.dryRun));
  actions.push(await patchDesktopTools(sourceRoot, context.dryRun));
  actions.push(...await patchOptionalSourceFiles(sourceRoot, context.dryRun));
  const failed = actions.filter((action) => action.status === "failed").length;
  const changed = actions.filter((action) => action.status === "updated" || action.status === "would-update").length;
  const status = failed > 0 ? "needs-attention" : changed > 0 ? "ready" : "ready";
  return result({ status, sourceRoot, actions });
}

async function patchOptionalSourceFiles(sourceRoot, dryRun) {
  const actions = [];
  if (await exists(join(sourceRoot, MCP_CLIENT_PATH)) && await exists(join(sourceRoot, MCP_SERVER_PATH))) {
    actions.push(await patchMcpClient(sourceRoot, dryRun));
    actions.push(await patchMcpServer(sourceRoot, dryRun));
  }
  if (await exists(join(sourceRoot, OPENAI_MIDDLEWARE_PATH))) {
    actions.push(await patchOpenAiMiddleware(sourceRoot, dryRun));
  }
  return actions;
}

async function findSourceRoot(context) {
  const candidates = [
    context.sourcePath,
    context.cwd,
    dirname(context.cwd),
    join(context.home, "supermemory-source"),
    join(context.home, "supermemory"),
    join(context.home, "src", "supermemory")
  ].filter(Boolean).map((path) => resolve(path));

  for (const candidate of [...new Set(candidates)]) {
    if (await exists(join(candidate, PAGE_PATH)) && await exists(join(candidate, TOOLS_PATH))) {
      return candidate;
    }
  }

  return null;
}

async function patchDesktopPage(sourceRoot, dryRun) {
  const path = join(sourceRoot, PAGE_PATH);
  const before = await readFile(path, "utf8");
  try {
    const after = enhanceDashboardPage(before);
    return await writePatchAction({
      title: "Embed Agent Memory panel in Supermemory Desktop",
      path,
      before,
      after,
      dryRun
    });
  } catch (error) {
    return {
      status: "failed",
      title: "Embed Agent Memory panel in Supermemory Desktop",
      path,
      detail: error.message
    };
  }
}

async function patchDesktopTools(sourceRoot, dryRun) {
  const path = join(sourceRoot, TOOLS_PATH);
  const before = await readFile(path, "utf8");
  try {
    const after = enhanceDesktopTools(before);
    return await writePatchAction({
      title: "Prefer Supermemory Local for coding-agent MCP",
      path,
      before,
      after,
      dryRun
    });
  } catch (error) {
    return {
      status: "failed",
      title: "Prefer Supermemory Local for coding-agent MCP",
      path,
      detail: error.message
    };
  }
}

async function patchMcpClient(sourceRoot, dryRun) {
  const path = join(sourceRoot, MCP_CLIENT_PATH);
  const before = await readFile(path, "utf8");
  try {
    const after = before.includes("export const DEFAULT_PROJECT_ID")
      ? before
      : replaceOnce(before, "const DEFAULT_PROJECT_ID = \"sm_project_default\"", "export const DEFAULT_PROJECT_ID = \"sm_project_default\"");
    return await writePatchAction({
      title: "Expose Supermemory MCP default project scope",
      path,
      before,
      after,
      dryRun
    });
  } catch (error) {
    return {
      status: "failed",
      title: "Expose Supermemory MCP default project scope",
      path,
      detail: error.message
    };
  }
}

async function patchMcpServer(sourceRoot, dryRun) {
  const path = join(sourceRoot, MCP_SERVER_PATH);
  const before = await readFile(path, "utf8");
  try {
    const after = enhanceMcpServer(before);
    return await writePatchAction({
      title: "Lock Supermemory MCP graph reads to one project",
      path,
      before,
      after,
      dryRun
    });
  } catch (error) {
    return {
      status: "failed",
      title: "Lock Supermemory MCP graph reads to one project",
      path,
      detail: error.message
    };
  }
}

async function patchOpenAiMiddleware(sourceRoot, dryRun) {
  const path = join(sourceRoot, OPENAI_MIDDLEWARE_PATH);
  const before = await readFile(path, "utf8");
  try {
    const after = enhanceOpenAiMiddleware(before);
    return await writePatchAction({
      title: "Make OpenAI memory middleware fail open by default",
      path,
      before,
      after,
      dryRun
    });
  } catch (error) {
    return {
      status: "failed",
      title: "Make OpenAI memory middleware fail open by default",
      path,
      detail: error.message
    };
  }
}

async function writePatchAction({ title, path, before, after, dryRun }) {
  if (before === after) {
    return {
      status: "unchanged",
      title,
      path,
      detail: "Already enhanced"
    };
  }

  if (dryRun) {
    return {
      status: "would-update",
      title,
      path,
      detail: "Would update source file"
    };
  }

  await writeFile(path, after);
  return {
    status: "updated",
    title,
    path,
    detail: "Updated source file"
  };
}

function enhanceDashboardPage(source) {
  if (source.includes("function AgentMemoryReadiness(")) {
    return source;
  }

  let output = source;
  output = replaceOnce(output, "\tArrowRight,\n", "\tArrowRight,\n\tBot,\n\tCheckCircle2,\n");
  output = replaceOnce(output, "\tSparkles,\n", "\tSparkles,\n\tUnplug,\n");
  output = replaceOnce(output, "import { SearchCommand, useCommandK } from \"@/components/search-command\"\n", [
    "import { SearchCommand, useCommandK } from \"@/components/search-command\"",
    "import {",
    "\tconnectDesktopTool,",
    "\tdetectDesktopTools,",
    "\ttype DesktopToolId,",
    "} from \"@/lib/tools\"",
    "import {",
    "\tsortDesktopToolCards,",
    "\ttoDesktopToolCard,",
    "\ttype DesktopToolCard,",
    "} from \"@/lib/tool-catalog\"",
    ""
  ].join("\n"));
  output = replaceOnce(output, "\tconst documents = documentsQuery.data?.documents ?? []\n", [
    "\tconst toolsQuery = useQuery({",
    "\t\tqueryKey: [\"desktop-tools\"],",
    "\t\tqueryFn: detectDesktopTools,",
    "\t\tstaleTime: 30 * 1000,",
    "\t})",
    "\tconst [connectingTool, setConnectingTool] = useState<DesktopToolId | null>(null)",
    "\tconst documents = documentsQuery.data?.documents ?? []"
  ].join("\n") + "\n");
  output = replaceOnce(output, "\tconst activeMemory =\n", [
    "\tconst toolCards = useMemo(",
    "\t\t() =>",
    "\t\t\tsortDesktopToolCards((toolsQuery.data ?? []).map(toDesktopToolCard)),",
    "\t\t[toolsQuery.data],",
    "\t)",
    "\tconst activeMemory ="
  ].join("\n") + "\n");
  output = replaceOnce(output, "\tconst visibleDocuments = documents.slice(0, 5)\n\n\tuseEffect(() => {", [
    "\tconst visibleDocuments = documents.slice(0, 5)",
    "\tconst connectedTools = toolCards.filter((tool) => tool.connected).length",
    "",
    "\tasync function connectTool(toolId: DesktopToolId) {",
    "\t\tsetConnectingTool(toolId)",
    "\t\ttry {",
    "\t\t\tawait connectDesktopTool(toolId)",
    "\t\t\tawait toolsQuery.refetch()",
    "\t\t} finally {",
    "\t\t\tsetConnectingTool(null)",
    "\t\t}",
    "\t}",
    "",
    "\tuseEffect(() => {"
  ].join("\n"));
  output = replaceOnce(output, "\t\t\t\t\t</div>\n\t\t\t\t\t<section className=\"mx-auto w-full max-w-2xl space-y-2\">", [
    "\t\t\t\t\t</div>",
    "\t\t\t\t\t<AgentMemoryReadiness",
    "\t\t\t\t\t\ttools={toolCards}",
    "\t\t\t\t\t\tloading={toolsQuery.isPending}",
    "\t\t\t\t\t\terror={toolsQuery.error}",
    "\t\t\t\t\t\tconnectedTools={connectedTools}",
    "\t\t\t\t\t\ttotalTools={toolCards.length}",
    "\t\t\t\t\t\tbusyTool={connectingTool}",
    "\t\t\t\t\t\tonConnect={connectTool}",
    "\t\t\t\t\t\tonRefresh={() => toolsQuery.refetch()}",
    "\t\t\t\t\t/>",
    "\t\t\t\t\t<section className=\"mx-auto w-full max-w-2xl space-y-2\">"
  ].join("\n"));
  output = replaceOnce(output, "function RecentMemoryRow({\n", `${agentMemoryComponent()}\nfunction RecentMemoryRow({\n`);
  return output;
}

function enhanceDesktopTools(source) {
  if (source.includes("DEFAULT_LOCAL_MCP_URL") && source.includes("fn mcp_url()")) {
    return source;
  }
  let output = source;
  output = replaceOnce(output, "const MCP_URL: &str = \"https://mcp.supermemory.ai/mcp\";", "const DEFAULT_LOCAL_MCP_URL: &str = \"http://localhost:6767/mcp\";");
  output = replaceOnce(output, "json!({ \"url\": MCP_URL })", "json!({ \"url\": mcp_url() })");
  output = replaceOnce(output, "args.push(MCP_URL);", "args.push(mcp_url());");
  output = replaceOnce(output, "fn write_config_atomically(path: &Path, bytes: &[u8]) -> Result<Option<PathBuf>, String> {\n", [
    "fn mcp_url() -> String {",
    "    env::var(\"SUPERMEMORY_MCP_URL\").unwrap_or_else(|_| DEFAULT_LOCAL_MCP_URL.to_string())",
    "}",
    "",
    "fn write_config_atomically(path: &Path, bytes: &[u8]) -> Result<Option<PathBuf>, String> {"
  ].join("\n"));
  return output;
}

function enhanceMcpServer(source) {
  if (source.includes("getEffectiveContainerTag(containerTag?: string): string")) {
    return source;
  }
  let output = source;
  output = replaceOnce(output, "import { SupermemoryClient } from \"./client\"", "import { DEFAULT_PROJECT_ID, SupermemoryClient } from \"./client\"");
  output = output.replaceAll(
    "const effectiveContainerTag =\n\t\t\t\t\t\t(args as { containerTag?: string }).containerTag ||\n\t\t\t\t\t\tthis.props?.containerTag",
    "const effectiveContainerTag = this.getEffectiveContainerTag(\n\t\t\t\t\t\t(args as { containerTag?: string }).containerTag,\n\t\t\t\t\t)"
  );
  output = output.replaceAll(
    "const effectiveContainerTag =\n\t\t\t\t\t\targs.containerTag || this.props?.containerTag",
    "const effectiveContainerTag = this.getEffectiveContainerTag(\n\t\t\t\t\t\targs.containerTag,\n\t\t\t\t\t)"
  );
  output = output.replaceAll(
    "const containerTags = effectiveContainerTag\n\t\t\t\t\t\t? [effectiveContainerTag]\n\t\t\t\t\t\t: undefined",
    "const containerTags = [effectiveContainerTag]"
  );
  output = replaceOnce(output, "const client = this.getClient(containerTag)\n\t\t\t\t\tconst profileResult = await client.getProfile()", "const containerTag = this.getEffectiveContainerTag(\n\t\t\t\t\t\t(args as { containerTag?: string }).containerTag,\n\t\t\t\t\t)\n\t\t\t\t\tconst client = this.getClient(containerTag)\n\t\t\t\t\tconst profileResult = await client.getProfile()");
  output = replaceOnce(output, "const effectiveContainerTag = containerTag || this.props?.containerTag", "const effectiveContainerTag = this.getEffectiveContainerTag(containerTag)");
  output = replaceOnce(output, "const client = this.getClient(containerTag)\n\t\t\tconst clientInfo = await this.getClientInfo()", "const client = this.getClient(effectiveContainerTag)\n\t\t\tconst clientInfo = await this.getClientInfo()");
  output = replaceOnce(output, "containerTag: containerTag || this.props?.containerTag,", "containerTag: effectiveContainerTag,");
  output = replaceOnce(output, "\tprivate getMcpSessionId(): string {\n\t\treturn this.ctx.id.name || \"unknown\"\n\t}\n", "\tprivate getMcpSessionId(): string {\n\t\treturn this.ctx.id.name || \"unknown\"\n\t}\n\n\tprivate getEffectiveContainerTag(containerTag?: string): string {\n\t\treturn containerTag || this.props?.containerTag || DEFAULT_PROJECT_ID\n\t}\n");
  return output;
}

function enhanceOpenAiMiddleware(source) {
  if (source.includes("skipMemoryOnError?: boolean")) {
    return source;
  }
  let output = source;
  output = replaceOnce(output, "\tbaseUrl?: string\n}", "\tbaseUrl?: string\n\t/**\n\t * When memory retrieval fails, continue with the original OpenAI request.\n\t * Defaults to true so Supermemory outages do not fail the user's chat call.\n\t */\n\tskipMemoryOnError?: boolean\n}");
  output = replaceOnce(output, "\tbaseUrl: string,\n) => {", "\tbaseUrl: string,\n\tskipMemoryOnError: boolean,\n) => {");
  output = replaceOnce(output, "\tconst memoriesResponse = await supermemoryProfileSearch(\n\t\tcontainerTag,\n\t\tqueryText,\n\t\tbaseUrl,\n\t)\n", "\tlet memoriesResponse: SupermemoryProfileSearch\n\ttry {\n\t\tmemoriesResponse = await supermemoryProfileSearch(\n\t\t\tcontainerTag,\n\t\t\tqueryText,\n\t\t\tbaseUrl,\n\t\t)\n\t} catch (error) {\n\t\tif (!skipMemoryOnError) {\n\t\t\tthrow error\n\t\t}\n\t\tlogger.warn(\"Supermemory profile search failed; continuing without injected memories\", {\n\t\t\tcontainerTag,\n\t\t\terror: error instanceof Error ? error.message : String(error),\n\t\t\tmode,\n\t\t})\n\t\treturn messages\n\t}\n");
  output = replaceOnce(output, "\tconst addMemory = options?.addMemory ?? \"always\"\n", "\tconst addMemory = options?.addMemory ?? \"always\"\n\tconst skipMemoryOnError = options?.skipMemoryOnError ?? true\n");
  output = replaceOnce(output, "\t\tconst memoriesResponse = await supermemoryProfileSearch(\n\t\t\tcontainerTag,\n\t\t\tqueryText,\n\t\t\tbaseUrl,\n\t\t)\n", "\t\tlet memoriesResponse: SupermemoryProfileSearch\n\t\ttry {\n\t\t\tmemoriesResponse = await supermemoryProfileSearch(\n\t\t\t\tcontainerTag,\n\t\t\t\tqueryText,\n\t\t\t\tbaseUrl,\n\t\t\t)\n\t\t} catch (error) {\n\t\t\tif (!skipMemoryOnError) {\n\t\t\t\tthrow error\n\t\t\t}\n\t\t\tlogger.warn(\n\t\t\t\t`Supermemory retrieval failed for ${context} API; continuing without injected memories`,\n\t\t\t\t{\n\t\t\t\t\tcontainerTag,\n\t\t\t\t\terror: error instanceof Error ? error.message : String(error),\n\t\t\t\t\tmode,\n\t\t\t\t},\n\t\t\t)\n\t\t\treturn \"\"\n\t\t}\n");
  output = replaceOnce(output, "\t\toperations.push(\n\t\t\taddSystemPrompt(messages, containerTag, logger, mode, baseUrl),\n\t\t)\n", "\t\toperations.push(\n\t\t\taddSystemPrompt(\n\t\t\t\tmessages,\n\t\t\t\tcontainerTag,\n\t\t\t\tlogger,\n\t\t\t\tmode,\n\t\t\t\tbaseUrl,\n\t\t\t\tskipMemoryOnError,\n\t\t\t),\n\t\t)\n");
  output = replaceOnce(output, "\t\tconst enhancedMessages = results[results.length - 1] // Enhanced messages result is always last\n", "\t\tconst enhancedMessages = results[\n\t\t\tresults.length - 1\n\t\t] as OpenAI.Chat.Completions.ChatCompletionMessageParam[] // Enhanced messages result is always last\n");
  return output;
}

function agentMemoryComponent() {
  return `function AgentMemoryReadiness({
\ttools,
\tloading,
\terror,
\tconnectedTools,
\ttotalTools,
\tbusyTool,
\tonConnect,
\tonRefresh,
}: {
\ttools: DesktopToolCard[]
\tloading: boolean
\terror: Error | null
\tconnectedTools: number
\ttotalTools: number
\tbusyTool: DesktopToolId | null
\tonConnect: (toolId: DesktopToolId) => Promise<void>
\tonRefresh: () => void
}) {
\tconst hasConnectedTool = connectedTools > 0

\treturn (
\t\t<section className="mx-auto w-full max-w-2xl rounded-2xl border border-white/[0.06] bg-[#0B1018]/56 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
\t\t\t<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
\t\t\t\t<div className="min-w-0">
\t\t\t\t\t<p className="flex items-center gap-2 font-medium text-[10px] text-fg-faint uppercase tracking-[0.12em]">
\t\t\t\t\t\t<Bot className="size-3.5 text-[#8BC6FF]" />
\t\t\t\t\t\tAgent memory
\t\t\t\t\t</p>
\t\t\t\t\t<h2 className="mt-2 font-medium text-lg text-white">
\t\t\t\t\t\t{hasConnectedTool
\t\t\t\t\t\t\t? "Your coding agent can reach memory"
\t\t\t\t\t\t\t: "Connect your coding agent before you rely on recall"}
\t\t\t\t\t</h2>
\t\t\t\t\t<p className="mt-1 max-w-xl text-fg-subtle text-sm">
\t\t\t\t\t\tSupermemory is only useful during coding when the agent can search before
\t\t\t\t\t\tit answers and save durable facts after the session. This checks that loop
\t\t\t\t\t\twhere you start work, not hidden in settings.
\t\t\t\t\t</p>
\t\t\t\t</div>
\t\t\t\t<div className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[12px] text-fg-muted">
\t\t\t\t\t{hasConnectedTool ? (
\t\t\t\t\t\t<CheckCircle2 className="size-3.5 text-emerald-300" />
\t\t\t\t\t) : (
\t\t\t\t\t\t<Unplug className="size-3.5 text-amber-300" />
\t\t\t\t\t)}
\t\t\t\t\t{connectedTools}/{totalTools || 3} connected
\t\t\t\t</div>
\t\t\t</div>

\t\t\t<div className="mt-4 grid gap-2">
\t\t\t\t{loading ? (
\t\t\t\t\t<div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-fg-subtle text-sm">
\t\t\t\t\t\t<Loader2 className="size-4 animate-spin" />
\t\t\t\t\t\tChecking Claude Code, Codex, and Cursor...
\t\t\t\t\t</div>
\t\t\t\t) : null}
\t\t\t\t{error ? (
\t\t\t\t\t<div className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-red-100 text-sm">
\t\t\t\t\t\tCould not check agent tools: {error.message}
\t\t\t\t\t</div>
\t\t\t\t) : null}
\t\t\t\t{tools.map((tool) => (
\t\t\t\t\t<AgentToolRow
\t\t\t\t\t\tkey={tool.id}
\t\t\t\t\t\ttool={tool}
\t\t\t\t\t\tbusy={busyTool === tool.id}
\t\t\t\t\t\tonConnect={() => onConnect(tool.id)}
\t\t\t\t\t/>
\t\t\t\t))}
\t\t\t</div>

\t\t\t<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-white/[0.05] border-t pt-3">
\t\t\t\t<div className="text-[12px] text-fg-subtle">
\t\t\t\t\tFlow: recall before prompt, answer with context, then capture
\t\t\t\t\tdurable decisions.
\t\t\t\t</div>
\t\t\t\t<button
\t\t\t\t\ttype="button"
\t\t\t\t\tonClick={onRefresh}
\t\t\t\t\tclassName="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-fg-subtle transition-colors hover:bg-white/[0.05] hover:text-white"
\t\t\t\t>
\t\t\t\t\t<RefreshCcw className="size-3.5" />
\t\t\t\t\tRefresh
\t\t\t\t</button>
\t\t\t</div>
\t\t</section>
\t)
}

function AgentToolRow({
\ttool,
\tbusy,
\tonConnect,
}: {
\ttool: DesktopToolCard
\tbusy: boolean
\tonConnect: () => void
}) {
\treturn (
\t\t<div className="grid gap-3 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
\t\t\t<div className="min-w-0">
\t\t\t\t<div className="flex flex-wrap items-center gap-2">
\t\t\t\t\t<span className="font-medium text-sm text-white">{tool.name}</span>
\t\t\t\t\t<span
\t\t\t\t\t\tclassName={[
\t\t\t\t\t\t\t"rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-[0.1em]",
\t\t\t\t\t\t\ttool.connected
\t\t\t\t\t\t\t\t? "bg-emerald-400/14 text-emerald-200"
\t\t\t\t\t\t\t\t: tool.detected
\t\t\t\t\t\t\t\t\t? "bg-amber-400/14 text-amber-200"
\t\t\t\t\t\t\t\t\t: "bg-white/[0.06] text-fg-subtle",
\t\t\t\t\t\t].join(" ")}
\t\t\t\t\t>
\t\t\t\t\t\t{tool.connected
\t\t\t\t\t\t\t? "connected"
\t\t\t\t\t\t\t: tool.detected
\t\t\t\t\t\t\t\t? "detected"
\t\t\t\t\t\t\t\t: "not found"}
\t\t\t\t\t</span>
\t\t\t\t</div>
\t\t\t\t<p className="mt-1 text-fg-subtle text-xs">{tool.tagline}</p>
\t\t\t\t<p className="mt-1 text-[11px] text-fg-faint">{tool.detail}</p>
\t\t\t</div>
\t\t\t{tool.connected ? (
\t\t\t\t<div className="text-right text-[11px] text-fg-faint">
\t\t\t\t\t{tool.restartHint}
\t\t\t\t</div>
\t\t\t) : tool.detected ? (
\t\t\t\t<button
\t\t\t\t\ttype="button"
\t\t\t\t\tonClick={onConnect}
\t\t\t\t\tdisabled={busy}
\t\t\t\t\tclassName="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-white px-3 font-medium text-[#0B1018] text-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
\t\t\t\t>
\t\t\t\t\t{busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
\t\t\t\t\tConnect
\t\t\t\t</button>
\t\t\t) : (
\t\t\t\t<a
\t\t\t\t\thref={tool.docsUrl}
\t\t\t\t\ttarget="_blank"
\t\t\t\t\trel="noreferrer"
\t\t\t\t\tclassName="inline-flex h-9 items-center justify-center rounded-full border border-white/[0.08] px-3 font-medium text-fg-subtle text-sm transition-colors hover:bg-white/[0.05] hover:text-white"
\t\t\t\t>
\t\t\t\t\tSet up
\t\t\t\t</a>
\t\t\t)}
\t\t</div>
\t)
}
`;
}

function result({ status, sourceRoot, actions }) {
  const summary = actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, { updated: 0, unchanged: 0, "would-update": 0, failed: 0, skipped: 0 });
  return {
    command: "native-enhance",
    feature: "Native Supermemory enhancement",
    status,
    sourceRoot,
    actions,
    summary,
    exitCode: summary.failed > 0 ? 1 : 0
  };
}

function replaceOnce(source, needle, replacement) {
  if (!source.includes(needle)) {
    throw new Error(`Expected source marker not found: ${needle.slice(0, 80)}`);
  }
  return source.replace(needle, replacement);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
