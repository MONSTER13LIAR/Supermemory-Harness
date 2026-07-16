# Supermemory Harness (`smctl`) — Project Blueprint
**Hackathon:** Localhost 6767 (Supermemory Local) — July 9–13, 2026
**Builder:** Solo (monsterliar)
**Stack:** Supermemory Local (self-hosted, `./.supermemory`, port 6767), Gemini API free tier as LLM backend, Codex CLI as primary dev driver (v0.124.0+, native hooks engine)

> This file is context, not a task list. It explains what we're building, why, and the mindset behind every decision — not a fixed spec of features. Specific build tasks (e.g. "build the doctor command," "investigate the local install") are prompted separately, turn by turn. Read this file for direction before acting on any specific instruction.

---

## 1. Hackathon Rules (confirmed)
1. Teams of 1–4. Solo allowed.
2. Project must **meaningfully** use Supermemory Local.
3. Fresh work only: code written during build window (July 9–13). Boilerplate/libraries fine. Pre-built products rebadged are NOT fine — they check commit history.
4. **No prior projects (ResumeFirst, MadMeCodes work) may be reused or repurposed for this.** Built fresh, under the monsterliar identity.

---

## 2. What we're building, in one line
Infrastructure that makes **Supermemory Local itself better and easier to trust for every developer using it** — not an app that happens to use Supermemory as a feature.

## 3. Naming
- Project name (human-readable, README/pitch/demo title): **Supermemory Harness**
- CLI command (what people actually type): **`smctl`** — follows the same naming convention as tools like `kubectl`/`systemctl`, signaling real dev infra rather than a hackathon toy.

## 4. Mindset / Non-negotiables
- We are NOT building a downstream app that "uses" Supermemory as a feature (rejected ideas: scam-call baiter, interview copilot, client-memory app, journal app — all fine ideas, wrong category for this hackathon's spirit of what we want to build).
- We ARE building infrastructure in the spirit of ECC (Everything Claude Code), which won its own hackathon this way — not by being one clever trick, but by being the setup a developer would build themselves given 10 months, bundled into one install.
- Every proposed feature must pass this filter before we build it:
  **"Is this a real, unsolved, developer-acknowledged gap — or just glue code that a native feature already solves?"**
  - Example of something already rejected under this filter: a Codex↔Supermemory "bridge" plugin — rejected because Codex now has a native hooks engine (v0.124.0+), so that would just be config wiring, not a real technical contribution.
- Prefer broad, universally-felt utility over one narrow deep feature, unless there's spare time to add depth on top of a working broad core.
- Ship one thing working end-to-end over three things half-built. Extras get pitched as "roadmap," not promised as delivered.
- Don't oversell scope in the pitch. Be honest about what's a genuine fix vs. a nice-to-have.

## 5. Confirmed technical facts (verified, don't re-check mid-build)
- Supermemory Local stores everything in one directory: `./.supermemory`. API key env previously set at `~/.supermemory/env`. Server runs on `localhost:6767`.
- Supermemory's own blog has acknowledged a real limitation: MCP-based tool integrations can't control when an agent chooses to run tools, meaning "no control/data point to learn things from" — this is why they built dedicated hook-based plugins for Claude Code and OpenCode specifically.
- Codex historically got weaker, instruction-based (AGENTS.md) integration compared to Claude Code's proper hooks — but **Codex CLI v0.124.0+ now has a stable, native hooks engine**: `SessionStart`, `Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`/`PostCompact`, subagent events. Direct hook-based integration for Codex is now natively possible.
- Supermemory's dynamic dreaming: background memory consolidation (merges duplicates, resolves contradictions), no fixed cron, dreamt state catches up within ~15 min. Shows a passive "Dreaming" indicator in their dashboard for memories queued for consolidation — but there is no review/approval/discard step before it commits (confirmed via their own docs/blog). This is a genuine, unaddressed gap — a sibling Anthropic feature ("Dreams," a different product) explicitly treats input/output stores separately so a human can review before committing; Supermemory's own dreaming does not offer this.
- Because Supermemory Local is self-hosted, its internals (server code, local data store) are inspectable — which is what makes deeper ideas like a "review-before-commit" layer feasible here in a way they wouldn't be against a hosted/cloud-only product.
- Community submissions seen so far in this hackathon: an "ADHD reader" (PDF + comprehension quiz app) and a "farmer simulator" using Supermemory — neither touches dev infrastructure or cross-tool memory. Low competition in this lane as of now.

## 6. Direction for feature ideas (not a fixed list — evaluate anything new against Section 4's filter)
Broad categories worth building toward, roughly in order of "foundation first":
- **Diagnostics** — helping a developer understand the current state of their Supermemory setup and catch misconfiguration (this is foundational; other features will reuse this same detection logic).
- **Setup/config automation** — reducing the manual, error-prone work of wiring Supermemory into multiple coding tools consistently.
- **Safety nets** — protecting against real risks that come from agents auto-capturing session context into persistent memory (e.g. secrets/credentials).
- **Transparency into Supermemory's own automatic behavior** — particularly around dreaming/consolidation, which currently offers no visibility or control, only if time allows after the foundation is solid.

Do not treat this list as commitments — each one gets scoped and greenlit individually as we go, based on real time remaining and what's actually feasible against the live local install.

## 7. Branding note
- Project name: **Supermemory Harness**
- CLI command: **`smctl`**
- Ship under **monsterliar** — not MadMeCodes. Consistent across README, demo video, and submission materials.

## 8. Working agreement for build turns
- Codex is acting as primary technical lead for the hackathon build.
- Investigate live local behavior before implementing commands; do not assume file layout, endpoint names, config locations, or tool behavior.
- Apply the Section 4 filter to every proposed feature, including user-suggested ones. Push back if a request is just shallow glue for something native tools already solve.
- Keep scope tight for the July 13 deadline. Prefer one complete, demoable command/workflow over multiple partial features.
- Ask at most one clarifying question when ambiguity would materially affect the build; otherwise choose the most reasonable interpretation and proceed.
- Update this file when a real product/scope decision changes, so it remains the project source of truth.

## 9. Current greenlit foundation
- First command to build: **`smctl doctor`**.
- Scope is diagnostics only first: inspect Supermemory Local install, server reachability, API key file shape, route behavior, and coding-tool integration config presence.
- Do not mutate user tool configs in `doctor`; setup automation is a later command.
- `doctor` must redact secrets and never print the Supermemory API key.

## 10. `smctl doctor` investigation findings (July 10)
- Confirmed real Supermemory Local install/store is `~/.supermemory`; server binary is `~/.supermemory/bin/supermemory-server`; PATH wrapper is `~/.local/bin/supermemory-server`; installed version is `0.0.3`.
- Confirmed local data is in `~/.supermemory/data`; runtime includes PGlite files under `~/.supermemory/runtime`.
- Confirmed key/config files exist: `api-key`, `auth-secret`, and encrypted `env.enc`. The API key file has sane shape (`sm_` prefix, 90 chars trimmed), but `doctor` must never print it.
- Confirmed the server is not always running. When started from `$HOME`, it listens on `http://localhost:6767` and uses `~/.supermemory`.
- Confirmed launch directory matters: starting `supermemory-server` from the repo created/used a project-local `.supermemory` and failed because that store had no model provider key. `doctor` should warn when both home and project-local Supermemory stores exist.
- Confirmed `/` is the practical liveness endpoint and returns the dashboard. `/v4/openapi` returns the OpenAPI JSON. `/health`, `/status`, `/api/health`, `/v1/memories`, and `/api/v3/memories` returned 404.
- Confirmed real API routes include `/v3/documents`, `/v3/documents/list`, `/v3/search`, `/v4/conversations`, `/v4/memories`, and `/v4/search`.
- Confirmed localhost auth behavior: `POST /v3/search` returned 200 with no auth, invalid bearer token, and valid bearer token because localhost auto-applies the API key. Therefore `doctor` must not claim it validates API-key correctness through localhost; it should report key file presence/shape and API reachability separately.
- Confirmed field names from OpenAPI: `/v3/documents` uses `containerTag` and deprecated `containerTags`; `/v4/conversations` uses `containerTags`.
- Confirmed installed coding tools on this machine: Claude Code and Codex are present; OpenCode and Cursor are not on PATH.
- Confirmed no active Supermemory integration config found for Claude Code (`~/.claude/settings*.json`, `~/.claude.json`) or Codex (`~/.codex/config.toml`). No Cursor `~/.cursor/mcp.json` or OpenCode config found.
- Confirmed dashboard integration snippets expect: Claude Code env vars `SUPERMEMORY_BASE_URL` and `SUPERMEMORY_CC_API_KEY`; Codex env vars `SUPERMEMORY_BASE_URL` and `SUPERMEMORY_CODEX_API_KEY`; OpenCode env vars `SUPERMEMORY_BASE_URL` and `SUPERMEMORY_API_KEY`; Cursor MCP at `~/.cursor/mcp.json` pointing to `http://localhost:6767/mcp`.
- Follow-up cleanup needed before/while implementing: remove the accidental repo-local `.supermemory` created during investigation, since it was produced by this probing and not project source.

## 11. `smctl doctor` implementation status (July 11)
- Created first runnable Supermemory Harness package as a dependency-free Node CLI with command `smctl doctor`.
- `doctor` is read-only and currently checks: home install/store shape, server binary/PATH wrapper/version, API key/auth/env file presence and API key shape without printing secrets, project-local `.supermemory` collision risk, dashboard/OpenAPI reachability, expected route visibility from `/v4/openapi`, and Claude Code/Codex/OpenCode/Cursor integration config presence.
- CLI supports human output and `--json` output for future automation.
- Local verification result on July 11: tests pass; current machine has a valid-looking home install but `localhost:6767` is not reachable (`ECONNREFUSED`), and the latest Supermemory startup log says startup failed because port 6767 may be in use.
- Still intentionally not implemented: mutating setup/config automation, hook installation, memory review workflow, or any command that prints API key material.

## 12. Hardware / Robotics Memory Direction
Question: can a hardware project, such as a robotic arm, connect to Supermemory Local so it builds experience over time?

Answer: **yes, if the hardware project has any local software bridge that can send events to the Supermemory Local HTTP API.** Supermemory does not need to run on the microcontroller itself. The normal architecture should be:

1. Hardware device or robot emits events through its controller, companion computer, logs, serial output, ROS node, MQTT topic, or local app.
2. A small local adapter on the developer machine or edge computer summarizes those events into meaningful memory writes.
3. The adapter sends those memories to Supermemory Local on `localhost:6767`, tagged by device/project/session.
4. Later software can query Supermemory for prior calibration, failures, environmental behavior, part wear, task outcomes, and successful fixes.

This means a robotic arm can develop useful local memory such as:
- calibration offsets that worked for a specific arm,
- motor overheating patterns,
- failed grasp attempts and what fixed them,
- object-specific handling notes,
- room/environment constraints,
- firmware/config changes and their effects,
- recurring sensor noise or mechanical drift.

What Supermemory does **not** do by itself today:
- directly read Arduino/ESP32 firmware state,
- directly subscribe to ROS/MQTT/serial streams,
- understand raw telemetry without an adapter,
- decide which low-level sensor values deserve long-term memory.

Harness opportunity: build **`smctl hardware`** as a hardware memory adapter toolkit.

Possible commands:
- `smctl hardware init` — create a hardware memory profile with device name, project tag, adapter type, and event schema.
- `smctl hardware ingest --from <file|serial|mqtt|ros>` — turn logs/events into Supermemory documents.
- `smctl hardware observe` — run a local listener that watches device events and writes useful memories.
- `smctl hardware coach` — show what the robot/hardware has learned and what gaps remain.
- `smctl hardware replay` — summarize previous failures/fixes before a new test run.

Design rules:
- Store experiences, not raw noisy telemetry.
- Keep project/device/session tags strict: `hardware:<device>`, `project:<project>`, `session:<date-or-run>`.
- Use local Llama when available to compress raw logs into short, useful memories.
- Never write secrets, Wi-Fi passwords, private keys, or full environment dumps.
- Keep Supermemory Local as the durable memory store; Harness is the adapter/enrichment layer.

Why this is a real product direction:
- Hardware work is repetitive and painful: calibration, failed runs, logs, and small fixes get forgotten.
- Robots and devices behave differently per build, location, and component batch.
- A local memory layer is valuable because hardware logs can be private, physical, and environment-specific.
- This expands Supermemory from coding-agent memory into **real-world device experience memory**, which is a stronger pitch than another generic app integration.

## 13. Shipped Progress Snapshot (July 12)
Code pushed to GitHub through commit `0556065` on `main`.

Delivered product layers:
- Core install/start/status/doctor/setup/smoke/verify flow for Supermemory Harness.
- Guard proxy that can enrich memory writes with project/skillset metadata before forwarding to Supermemory Local.
- Local Llama/Ollama brain for plain-English explanations with deterministic fallback when model output is slow or wrong.
- Memory insight commands:
  - `smctl score`
  - `smctl repair wizard`
  - `smctl cleanup`
  - `smctl memory coach`
  - `smctl project`
  - `smctl timeline`
- Markdown agent skills for memory write hygiene, query patterns, context injection, health triage, project personalization, and conflict resolution.
- Hardware/robotics adapter MVP:
  - `smctl hardware init`
  - `smctl hardware ingest`
  - `smctl hardware observe`
  - `smctl hardware coach`
  - `smctl hardware replay`

Current hardware adapter behavior:
- Supermemory itself remains the local memory store.
- Harness acts as the bridge/enrichment layer.
- Hardware logs can come from a file or stdin.
- Arduino/ESP32/robot tools can pipe monitor output into Harness, e.g. `arduino-cli monitor ... | smctl hardware observe --stdin`.
- Harness summarizes noisy logs into useful experience memories.
- Memories are tagged by device/session, e.g. `hardware:robot-arm-v1`, `session:grasp-test`.
- Local Llama is attempted for summarization; deterministic heuristics are used if Llama is unavailable.
- Direct serial/MQTT/ROS adapters are not bundled yet; stdin piping is the dependency-free MVP.

Verified:
- Full test suite passed after hardware work: 17/17.
- Dry-run hardware observe successfully converted sample robot-arm logs into a device/session-tagged experience summary without writing to Supermemory.
- `git status` clean and `main` matches `origin/main` after pushing.

## 14. Next Hardware Work
The next product step is to make the hardware flow feel automatic instead of requiring the user to understand logs, ports, tags, or setup.

Build next:
- `smctl hardware detect` — inspect the current folder and machine for hardware signals.
- `smctl hardware doctor` — check whether the hardware memory flow is ready.
- `smctl hardware init --auto` — create the profile from detected hardware context.

Detection signals to support:
- Arduino: `.ino`, `arduino-cli.yaml`.
- PlatformIO: `platformio.ini`.
- ESP32/embedded C/C++: `sdkconfig`, `CMakeLists.txt`, `main/*.c`, `main/*.cpp`.
- ROS/ROS2: `package.xml`, `launch/`, `urdf/`, `ros2` workspace layout.
- Python hardware: `pyserial`, `gpiozero`, `RPi.GPIO`, `paho-mqtt`.
- Node hardware: `serialport`, `johnny-five`.
- Connected device hints: `/dev/ttyUSB*`, `/dev/ttyACM*`, maybe `/dev/serial/by-id/*` on Linux.

Good UX target:
```bash
smctl hardware detect
smctl hardware init --auto
smctl hardware observe
```

The command should explain what it found, suggest the right monitor command, and keep the user away from manual port/tag decisions where possible.

## 15. Harness Bar / Memory Activity UI Direction
New greenlit UI feature: **Harness Bar**, shipped first as `smctl watch`.

Product intent:
- Give developers a compact status strip for Supermemory Local instead of forcing them to infer invisible memory behavior from separate commands.
- Make memory activity trustworthy by showing Local reachability, agent integration state, recent writes, queued/processing work, inferred dreaming/consolidation activity, Guard risk, recent events, and the next command to run.
- Treat this as the terminal MVP of a strip that could later be embedded globally inside the Supermemory Local dashboard, with detailed agent/plugin state still living in an Integrations/Plugins view.

Design rules:
- Keep the strip global and scan-first, like an editor status bar.
- Do not make it a marketing page or a decorative dashboard.
- Use focused panels below the strip for Local, agents, memory flow, Guard, and recent events.
- The command is observability-first and read-only.

Implementation decision:
- Supermemory Local's installed dashboard is served from the compiled `supermemory-server` binary; no editable frontend source/static asset directory is present in `~/.supermemory`.
- Do not binary-patch Supermemory. It is brittle and unsafe.
- Ship embedded dashboard support as `smctl ui`: a local proxy that fetches the Supermemory dashboard from `localhost:6767`, injects the Harness Bar into the HTML, and proxies the rest of the UI/API through.
- User flow: run `supermemory-server`, then `smctl ui`, then open `http://localhost:6778` to use Supermemory with the Harness Bar embedded at the top.

Deep problem to solve next:
- A coding user can have Supermemory Local online while the actual agent-memory workflow is still broken: Codex/Claude not configured, writes failing, memories missing project context, secrets or vague notes entering memory, duplicates accumulating, or documents existing without recallable memories.
- The embedded UI must not only show status; it must guide the user from "server is running" to "coding-agent memory is connected, scoped, safe, and recallable."

Implemented direction:
- Add an embedded command center behind the Harness Bar with Overview, Trust, Setup, Memory, Repair, Guard, and Events tabs.
- Add a Memory Flight Recorder/Trust tab powered by Harness analysis: failed writes, stale queues, retry loops, secret risk, vague memories, duplicate groups, missing project tags, empty recall containers, store size risk, memory score, and next commands.
- Add embedded routes `/__smctl/panel`, `/__smctl/flight`, `/__smctl/setup/apply`, and `/__smctl/verify` so the Supermemory tab can perform safe setup and verification directly.

Productized installer feature:
- Feature name: **Harness Enhance**.
- CLI command: `smctl enhance`.
- Purpose: automatically make Supermemory Local agent-memory ready for normal users.
- Behavior: check Supermemory Local, apply safe setup, install Harness skills, prepare embedded Supermemory dashboard support, check project scope, and return a clear next path.
- Naming rule: keep product name **Supermemory Harness**, command name **smctl**, feature name **Harness Enhance**.

## 16. Terminal-Native Harness + Agent Bridge Progress (July 14)
New shipped direction: **Supermemory Harness should show up where Supermemory users already are**.

Problem being solved:
- A developer running Supermemory Local usually sees either the Supermemory browser dashboard or the raw `supermemory-server` terminal logs.
- Harness diagnostics were useful, but if they only lived in a separate Harness command/tab, the user still had to context-switch and manually explain the state to Codex or Claude Code.
- The product direction is now: Harness should sit inside the Supermemory operating flow itself, especially the terminal/log flow and the coding-agent flow.

Implemented:
- Added `smctl supermemory start`.
  - Starts the real `supermemory-server`.
  - Streams Supermemory's own stdout/stderr as `[supermemory] ...`.
  - Injects Harness health, trust, and watchdog events into the same terminal stream as `[harness] ...`.
  - This makes the doctor/watch/trust layer visible inside the Supermemory terminal experience instead of requiring a separate Harness terminal.
- Added `smctl agent connect codex|claude|all`.
  - Installs local bridge instructions for Codex and Claude Code-style agents.
  - The bridge tells agents to run `smctl trust --json`, `smctl trust --probe`, and `smctl repair wizard` when the user asks what is happening with Supermemory.
  - The goal is that the user can ask the coding agent directly instead of reading Supermemory logs manually.
- Added `smctl agent status`.
  - Shows whether the local bridge instruction files are installed.
- Updated README command docs and examples.
- Added tests for the terminal wrapper and agent bridge.

Current UX:
```bash
smctl supermemory start
```

Expected stream shape:
```text
[harness] launching Supermemory Local with Harness terminal overlay: /path/to/supermemory-server
[supermemory] ...
[harness] startup 2026-07-14T... Trust 82/100 (Usable); 0 fail, 2 warn
[harness] Local: online | Agents: 2/4 | Writes: 12 | Queue: 0
[harness] watchdog 2026-07-14T... Trust ...
```

Agent bridge UX:
```bash
smctl agent connect all
smctl agent status
```

Verification:
- Full test suite passed after this work: 24/24.
- Dry-run verified:
  - `node ./bin/smctl.js supermemory start --dry-run`
  - `node ./bin/smctl.js agent connect codex --dry-run`

Important next discussion checkpoint:
- Pick up from here by discussing **how this works for a normal installer/plugin user**.
- Decide whether `smctl enhance` should automatically:
  - install the agent bridge,
  - switch the user's recommended Supermemory launch command to `smctl supermemory start`,
  - add a shell alias/wrapper for `supermemory-server`,
  - or patch/integrate deeper with Supermemory Local source when source access is available.
- Clarify the boundary between:
  - terminal-native wrapping, which works today without modifying the binary,
  - dashboard embedding through `smctl ui`,
  - true source-level Supermemory modifications when the user has the editable Supermemory repo.
- The next product conversation should explain this architecture clearly so we can decide how automatic the install flow should be without surprising users or hiding what process is being run.

## 17. Automatic Enhancement Direction (July 15)
Product decision:
- Treat `smctl enhance` as the single normal-user install/enhancement path, not as one option among several architectures.
- The user should not have to discover and run one command at a time. The install should do the useful work automatically, then explain only what remains.
- Internal implementation can still use multiple mechanisms: setup config, agent bridge files, terminal wrapping, dashboard proxy injection, and source-level enhancement when source is available. Those are implementation details behind the one enhancement flow.

Implemented update:
- `smctl enhance` now installs the Codex and Claude agent bridge automatically.
- `smctl enhance` now reports the agent bridge as a first-class action.
- `smctl enhance` now points users toward `smctl supermemory start` as the normal Supermemory terminal runtime so Harness health appears in the same log stream as Supermemory.
- README now states that `agent connect` is normally run by `enhance` and remains available only for refresh/inspection.

Direction going forward:
- Keep the default experience automatic and low-interaction.
- Do not force users to choose between "modes" during install.
- Use deeper Supermemory source enhancement when a source checkout is available, but keep the user-facing command the same: `smctl enhance`.
- Avoid binary patching the compiled Supermemory server. The powerful path is automatic enhancement through supported local files, runtime wrapping, dashboard proxying, and source patches when editable source exists.

## 18. Install Means Activation (July 16)
Product decision:
- Treat install/enhance as activation, not instruction. The user should not need to manually discover `smctl ui`, `smctl init`, or `smctl agent connect` for the essential experience.
- `smctl install` now runs the same automatic enhancement path as `smctl enhance`.
- `smctl enhance` now auto-initializes project memory scope when no active project profile exists.
- `smctl enhance` starts the embedded dashboard proxy automatically when Supermemory Local is reachable, or detects that it is already running.
- `smctl enhance` writes `~/.config/smctl/activation.json` so agents and users can see what was auto-enabled and what normal commands to use next.

Current essential activation bundle:
- local setup/config,
- memory behavior skills,
- Codex/Claude agent bridge,
- project scope initialization,
- embedded dashboard proxy/injection,
- terminal-native runtime guidance,
- native Supermemory source enhancement when source is available,
- memory visibility/watch snapshot,
- activation receipt.

Follow-up local improvement:
- When the live Supermemory server exposes OpenAPI but `/mcp` returns 404, Harness now gives the exact repair path: run `supermemory-server upgrade`, restart with `smctl supermemory start`, then re-run `smctl doctor`.
