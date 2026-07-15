# Supermemory Hard Gaps

This is the evidence-backed build map for making Supermemory Local better through Harness.
The goal is not a separate dashboard that watches from the side. Each gap should become an
automatic enhancement, source patch, terminal overlay, proxy behavior, or agent bridge behavior
that changes how Supermemory is used locally.

## Sources Used

- Supermemory, "Introducing Dynamic Dreaming" (May 25, 2026):
  https://supermemory.ai/blog/introducing-dynamic-dreaming-supermemory-now-connects-the-dots-for-you
- Supermemory, "Infinitely running stateful coding agents" (Feb. 19, 2026):
  https://supermemory.ai/blog/infinitely-running-stateful-coding-agents
- Supermemory, "The UX and technicalities of awesome MCPs" (June 8, 2025):
  https://supermemory.ai/blog/the-ux-and-technicalities-of-awesome-mcps
- Adler and Zehavi, "Storage Is Not Memory: A Retrieval-Centered Architecture for Agent Recall"
  (May 6, 2026): https://arxiv.org/abs/2605.04897
- Malo and Qiu, "PROJECTMEM: A Local-First, Event-Sourced Memory and Judgment Layer for AI
  Coding Agents" (June 10, 2026): https://arxiv.org/abs/2606.12329

## Gap 1: Install Does Not Fully Activate The Agent Workflow

Evidence:
- Supermemory's MCP writeup says MCP installation UX is painful and client behavior differs
  across tools.
- The coding-agent writeup says the useful flow depends on project init, context injection,
  automatic capture, privacy, and project/user scoping, not only the server being reachable.

Harness fix:
- `smctl enhance` must be the single automatic path. It should install bridge instructions,
  setup config, skills, UI support, native source enhancements when available, and point users
  toward the Harness-wrapped Supermemory runtime.

Status:
- Shipped. `smctl enhance` now installs the Codex and Claude bridge automatically and makes
  `smctl supermemory start` the normal next runtime.

## Gap 2: Supermemory Terminal Logs Do Not Explain Memory Trust

Evidence:
- A normal user sees server logs, not memory health. The coding-agent writeup describes an
  invisible memory loop: retrieve before prompt, save after work, and resume later.

Harness fix:
- Keep `smctl supermemory start` as the main runtime and make the overlay more actionable:
  failed writes, project scope, recall probe status, bridge status, and exact next command.

Status:
- Shipped. The terminal overlay now prints trust score, blockers/warnings, agent bridge state,
  memory queue/failed/dreaming state, Guard risk, and the next command directly into the
  Supermemory server log stream.

## Gap 3: Dynamic Dreaming Has No Review, Diff, Or Grounding View

Evidence:
- Supermemory says Dynamic Dreaming merges, reweights, resolves contradictions, creates new
  memories, derivations, and an evolving profile in the background.
- It also says dreamt state catches up later, while unprocessed content remains queryable.

Harness fix:
- Add a local Dream Flight Recorder: detect likely pre-dream and post-dream changes, show
  inferred transformations, and flag high-risk profile changes for review.

Status:
- Shipped. `doctor` now probes `/mcp`, `watch` carries MCP readiness in the Harness Bar, and
  the terminal overlay prints MCP readiness/failure in the Supermemory log stream.

## Gap 4: Contradictions Can Be Resolved Invisibly

Evidence:
- Supermemory's dreaming post says contradictions get reconciled. That is good, but for coding
  memory a wrong reconciliation can poison future sessions.

Harness fix:
- Add contradiction audit: detect conflicting project facts, old-vs-new decisions, and missing
  source anchors; surface them in trust, repair, UI, and terminal overlay.

Status:
- Planned.

## Gap 5: Retrieval Quality Is Not Proved Before The Agent Relies On It

Evidence:
- The "Storage Is Not Memory" paper argues storage alone is not memory and reports that
  retrieval-centered architecture matters materially for recall quality.
- Supermemory's coding-agent writeup says semantic search results are injected invisibly before
  the model answers.

Harness fix:
- Expand `smctl trust --probe` into recall canaries: write scoped facts, verify exact search,
  semantic search, multilingual recall, and negative controls.

Status:
- Partially shipped through verify/smoke/trust probes. Needs canary suite.

## Gap 6: Project/User Scope Is Easy To Get Wrong

Evidence:
- Supermemory's coding-agent post says user-scoped memories should follow the user while
  project-specific memories should stay local to the repo.

Harness fix:
- Enforce scope at write time through Guard and native MCP source patches. Warn when broad
  reads occur without a container/project tag.

Status:
- Partially shipped through project profile, Guard enrichment, and native MCP default-project
  patch. Needs stricter write-time enforcement.

## Gap 7: Preemptive Compaction Is Agent-Specific Instead Of Universal

Evidence:
- Supermemory's coding-agent post says reactive compaction after context degradation is broken
  and that negative constraints must be preserved.

Harness fix:
- Add a universal compaction contract for Codex/Claude bridge instructions and source patches
  where available: preserve literal request, files touched, tests, blockers, failed attempts,
  and explicit vetoes.

Status:
- Planned.

## Gap 8: Secret Redaction Depends Too Much On User Behavior

Evidence:
- Supermemory's coding-agent post relies on `<private>` tags for explicit redaction.
- In real coding sessions, secrets commonly appear in logs, env dumps, stack traces, and config
  snippets without private tags.

Harness fix:
- Make Guard secret detection stricter and automatic. Add source-level middleware patches where
  possible so risky writes are redacted before Supermemory stores them.

Status:
- Partially shipped through Guard risk checks. Needs stronger detectors and native write patch.

## Gap 9: MCP Connection Reliability Is A Known Failure Mode

Evidence:
- Supermemory's MCP writeup says long-standing SSE connections can break and that users
  complained about connection loss.

Harness fix:
- Add MCP watchdog checks to `doctor`, `watch`, and terminal overlay. Detect stale MCP
  connections, unreachable `/mcp`, wrong URL mode, and client config drift.

Status:
- Planned.

## Gap 10: Memory Needs Governance, Not Just Recall

Evidence:
- PROJECTMEM frames useful coding memory as governance: warning before repeated failed fixes
  or fragile edits.
- Supermemory already stores memories, but agents still need local pre-action guidance.

Harness fix:
- Add a pre-action memory gate for coding agents: before edits/tests, retrieve relevant failed
  attempts, fragile files, user constraints, and project decisions; warn through bridge
  instructions and terminal overlay.

Status:
- Planned.
