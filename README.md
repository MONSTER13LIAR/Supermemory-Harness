```text
  ___ _ __ ___   ___| |_| |
 / __| '_ ` _ \ / __| __| |
 \__ \ | | | | | (__| |_| |
 |___/_| |_| |_|\___|\__|_|

 Supermemory Harness
 local guard · recall verify · repair diagnostics · local brain
```

# Supermemory Harness

`smctl` is the Supermemory Harness CLI: a local companion plugin for Supermemory Local. It installs safe integration config, checks memory health, adds Guard review, verifies recall, and can use a local Llama brain through Ollama for plain-English explanations.

## Run

Install and connect Harness:

```bash
npm install -g github:MONSTER13LIAR/Supermemory-Harness
smctl enhance
```

That same command works on macOS, Linux, and Windows PowerShell when Node.js 22+ and npm are installed. `smctl enhance` is the normal user flow: it checks Supermemory Local, applies safe Harness setup, installs memory behavior skills, connects Codex/Claude-style agents to Harness diagnostics, initializes project memory scope when missing, starts the embedded Supermemory dashboard proxy when Local is reachable, and writes an activation receipt at `~/.config/smctl/activation.json`.

When a Supermemory source checkout is present, `smctl enhance` also applies native Supermemory enhancements directly to that source:

- Agent Memory readiness panel on the Supermemory Desktop home screen.
- Local-first coding-agent MCP setup: `http://localhost:6767/mcp`, with `SUPERMEMORY_MCP_URL` as an override.
- Project Scope Lock for MCP graph/data reads, so graph/list views do not accidentally read across every project when the user expects the active/default project.
- Fail-open OpenAI middleware, so a temporary Supermemory retrieval failure does not crash the user's OpenAI chat request unless strict mode is explicitly enabled.

To point Harness at a checkout explicitly:

```bash
smctl enhance --supermemory-source /path/to/supermemory
```

`smctl install` also runs the same automatic enhancement flow, so installer agents can use either command and still activate the essential pieces immediately.

For local development from this repo:

```bash
node ./bin/smctl.js install
```

After enhancement, run Supermemory through Harness when you want the normal terminal server view plus Harness trust events in the same stream:

```bash
smctl supermemory start
```

Enhance initializes the current app/project automatically when no active profile exists. To refresh the project profile manually:

```bash
smctl init
```

The commands below are optional diagnostics and advanced controls.

Show every command:

```bash
smctl help
```

Check the full Harness state:

```bash
smctl enhance
smctl executive
smctl workflow
smctl watch
smctl trust
smctl supermemory start
smctl session pre-action
smctl agent connect all
smctl ui
smctl status
smctl status --explain
smctl score
smctl gate --explain
```

`watch` is the Harness Bar: a compact Supermemory activity strip for Local status, configured agent integrations, recent writes, queue/dreaming activity, Guard risk, and the next command to run. It is designed as the terminal MVP of a strip that could later live directly inside the Supermemory Local dashboard.

`workflow` is the simple architecture view. It explains the normal path from install to trust, maps the real Supermemory pain points Harness covers, and states the moral boundaries for automation: safe setup can be automatic; risky memory writes, live proof writes, and destructive cleanup require explicit user intent.

`executive` is the daily/final readiness cockpit. It runs the operational layers together, summarizes runtime, trust, Agent Autopilot, Dream Flight Recorder, Guard, and agent bridge state, then gives a prioritized action plan plus final checks before hosting or demoing.

`trust` is the Memory Trust Doctor: it answers whether Supermemory is safe to rely on right now. It checks Local reachability, active project scope, profile health, write pipeline symptoms, recall/container risks, local retry-loop logs, store growth, possible secrets, duplicates, and vague memories. It is read-only by default:

```bash
smctl trust
```

For a live proof, run:

```bash
smctl trust --probe
```

Probe mode writes a harmless marker and verifies ingest, processing, search, and container-scoped recall.

`supermemory start` is the terminal-native mode. It starts `supermemory-server`, streams Supermemory's own output, and injects Harness health events into the same terminal stream:

```bash
smctl supermemory start
```

Example stream:

```text
[supermemory] server listening on :6767
[harness] startup Trust 82/100 (Usable); 0 fail, 2 warn
[harness] Local: online | Agents: 2/4 | Writes: 12 | Queue: 0
```

`agent connect` installs a local bridge for Codex and Claude Code-style agents so they know how to query Harness before relying on Supermemory. `smctl enhance` already runs this automatically; the command remains available when you want to refresh or inspect the bridge directly:

```bash
smctl agent connect codex
smctl agent connect claude
smctl agent status
```

The bridge tells agents to run `smctl session pre-action`, `smctl session pre-compact`, `smctl session stop`, `smctl trust --json`, `smctl repair wizard`, and `smctl trust --probe` when the user asks what is happening with Supermemory or when the agent reaches a lifecycle boundary.

`session` is Agent Memory Autopilot. It exposes hookable lifecycle gates for coding tools: `pre-action` blocks or warns before risky edits when memory is not trustworthy, `pre-compact` prints the exact handoff contract to preserve before context compaction, and `stop` checks whether the session can hand off with usable Supermemory state.

`ui` embeds that same Harness Bar into the Supermemory dashboard through a local proxy. `smctl enhance` starts it automatically when Supermemory Local is reachable; the command remains available if you want to restart it:

```bash
smctl ui
```

Open `http://localhost:6778` to use the Supermemory dashboard with the Harness Bar at the top.

The embedded panel includes an in-Supermemory command center:

- Overview: the path from local server to connected coding tools to verified recall.
- Trust: the Memory Trust Doctor plus a flight recorder for failed writes, missing project context, secrets, vague notes, duplicates, empty recall containers, and store risk.
- Setup: safe local setup actions and manual coding-tool installer steps.
- Memory: queue, dreaming, failed writes, and a verify probe.
- Repair: the ordered repair plan from Harness diagnostics.
- Guard: pending risky writes.
- Events: recent Supermemory write activity.

When something is wrong, use the guided path instead of guessing commands:

```bash
smctl repair wizard
smctl cleanup
smctl memory coach
```

```bash
npm run doctor
```

or:

```bash
node ./bin/smctl.js doctor
```

JSON output is available for automation:

```bash
node ./bin/smctl.js doctor --json
```

Set up local integration files:

```bash
node ./bin/smctl.js setup --dry-run
node ./bin/smctl.js setup
```

Verify the ingest and recall pipeline:

```bash
node ./bin/smctl.js verify
node ./bin/smctl.js smoke
```

`verify` is the full user-facing proof: it writes a harmless marker, confirms project-scoped recall, checks for container mismatch symptoms, and runs a multilingual recall probe. `smoke` is the smaller raw ingest/search check.

Inspect memory quality and failed ingests:

```bash
node ./bin/smctl.js memory doctor
node ./bin/smctl.js memory coach
node ./bin/smctl.js memory replay
node ./bin/smctl.js memory replay --apply
node ./bin/smctl.js repair
node ./bin/smctl.js repair wizard
node ./bin/smctl.js repair --explain
node ./bin/smctl.js score
node ./bin/smctl.js timeline
node ./bin/smctl.js cleanup
node ./bin/smctl.js project
```

Capture hardware or robotics experience:

```bash
smctl hardware init --name "robot-arm-v1"
smctl hardware ingest --from ./run.log --session grasp-test
arduino-cli monitor -p /dev/ttyUSB0 | smctl hardware observe --stdin --device robot-arm-v1 --session live-test
smctl hardware coach
smctl hardware replay
```

Hardware support is an adapter layer. The board or robot does not run Supermemory directly; its software bridge emits logs/events, and Harness compresses them into tagged Supermemory memories.

Check the local Llama brain:

```bash
smctl brain doctor
```

Install an app-specific local memory policy:

```bash
node ./bin/smctl.js skillset list
node ./bin/smctl.js skillset install developer
node ./bin/smctl.js skillset doctor
```

Inspect the markdown skills installed for agents:

```bash
smctl skills list
smctl skills doctor
```

Cloud Smart Assist is optional and not needed for the local-brain flow:

```bash
smctl smart enable --prompt
smctl smart enable --api-key-env LLM_API_KEY --yes
smctl smart doctor
smctl smart ping
```

`smart enable` can use `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` directly. For custom env names, pass `--api-key-env`; Harness infers OpenAI, Gemini, or Anthropic from the key shape. In the guided prompt, it prints the detected provider and rejects unknown key shapes so users do not accidentally save the wrong key. To paste a key directly into the terminal without putting it in shell history, run `smctl smart enable --prompt`; the input is hidden and stored in a local `0600` Harness secret file.

Review memory writes before commit:

```bash
node ./bin/smctl.js guard start
node ./bin/smctl.js guard inbox
node ./bin/smctl.js guard approve <id>
node ./bin/smctl.js guard reject <id>
```

## Current Scope

- `doctor` is read-only diagnostics.
- `enhance` is the automatic Supermemory Harness setup path: make Supermemory Local agent-memory ready, apply the native Supermemory Desktop source enhancement when available, otherwise prepare the embedded dashboard path and verify the memory loop.
- `executive` is the daily/final readiness cockpit for runtime, trust, Agent Autopilot, dreams, Guard, bridge status, prioritized actions, and hosting checks.
- `install` is the one-command onboarding flow for the Harness plugin.
- `init` detects the current project and writes an active project profile for memory enrichment.
- `start` checks Supermemory, project profile, skills, optional Ollama/Smart state, then starts Guard.
- `watch` shows the Harness Bar: Local health, agent configs, write counts, queue/dreaming state, Guard risk, recent events, and the next useful command.
- `workflow` shows the simple install-to-trust architecture, the real gaps covered, and the automation boundaries.
- `trust` decides whether Supermemory is scoped, healthy, recoverable, and safe to rely on. `trust --probe` adds a harmless live write/read/container recall proof.
- `supermemory start` runs Supermemory Local with Harness health and trust events in the same terminal output.
- `agent connect` installs local bridge instructions for Codex and Claude Code-style agents so they query Harness instead of making the user inspect logs manually.
- `session` provides hookable coding-agent lifecycle gates for pre-action memory governance, pre-compaction handoff, and stop/handoff trust checks.
- `ui` serves the Supermemory dashboard through a local proxy and injects the Harness Bar into the page.
- `ui` also exposes embedded Harness routes such as `/__smctl/panel`, `/__smctl/flight`, `/__smctl/setup/apply`, and `/__smctl/verify` so the Supermemory tab can guide setup, trust, repair, and verification without sending the user to a separate app.
- `status` gives one-screen health for Supermemory, memory quality, repair watchdog, and Guard.
- `score` gives one confidence number for whether Supermemory memory/retrieval looks trustworthy.
- `score`, `gate`, `dreams`, and `enhance` add Smart Sections automatically so the output names the decision, confidence, risks, activation state, and next command.
- `status --explain`, `score --explain`, `gate --explain`, `dreams --explain`, `enhance --explain`, `repair --explain`, `verify --explain`, and `start --dry-run --explain` use local Ollama/Llama when available to explain diagnostics in plain English.
- `project` shows the active app profile, project container, sampled project memories, and writes missing project context.
- `setup` writes `~/.config/smctl/supermemory.env` and merges Cursor MCP config at `~/.cursor/mcp.json`.
- `verify` proves that Supermemory can write, process, search, recall inside the active project container, and handle multilingual recall probes.
- `smoke` writes a harmless marker document, waits for processing, and searches for it.
- `memory doctor` checks failed documents, queued backlog, duplicate titles, memory-agent failures, and sampled memory entries.
- `memory coach` explains how to improve memory quality: clearer wording, project tags, duplicates, secrets, and recall gaps.
- `memory replay` safely resubmits failed text documents after provider/config issues are fixed.
- `repair` diagnoses failed documents, stale queues, retry-loop log hints, write/read mismatch symptoms, and local store size risk. It plans by default and avoids destructive cleanup.
- `repair wizard` turns repair diagnostics into a safe ordered plan.
- `timeline` shows recent write activity by day and top containers.
- `cleanup` plans safe cleanup for possible secrets, duplicates, old test markers, vague notes, and missing project context; it does not delete memories.
- `hardware` captures robotics/device logs as local experience memories through file or stdin bridges, with device/session tags.
- `skillset` installs local app-specific memory policies used by Guard.
- `skills` installs markdown memory behavior skills: write hygiene, query patterns, context injection format, health triage, project personalization, and conflict resolution.
- `smart` can use a provider env var or a hidden terminal prompt; prompted keys are stored in a local `0600` Harness secret file.
- `brain` checks local Ollama/Llama readiness for no-cloud explanations.
- `guard` runs a local review proxy for `POST /v3/documents`, adds active project/skillset metadata, flags risky memory writes, and requires approval before forwarding.
- Smart Assist is optional; Harness core skills and Guard enrichment work without provider API access.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not auto-run Claude Code, Codex, or OpenCode plugin installers yet; it prints the exact next commands instead.
