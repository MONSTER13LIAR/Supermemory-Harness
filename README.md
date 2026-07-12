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
smctl install
```

That same command works on macOS, Linux, and Windows PowerShell when Node.js 22+ and npm are installed. `smctl install` is the normal user flow: it shows the Harness startup screen, checks Supermemory Local, writes Harness config, installs memory behavior skills, and asks for optional Smart Assist setup in the terminal.

For local development from this repo:

```bash
node ./bin/smctl.js install
```

Initialize the current app/project so Harness can tag Supermemory writes with project context:

```bash
smctl init
```

Start the project-aware Guard/enrichment layer:

```bash
smctl start
```

The commands below are optional diagnostics and advanced controls.

Show every command:

```bash
smctl help
```

Check the full Harness state:

```bash
smctl status
smctl status --explain
smctl score
```

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
- `install` is the one-command onboarding flow for the Harness plugin.
- `init` detects the current project and writes an active project profile for memory enrichment.
- `start` checks Supermemory, project profile, skills, optional Ollama/Smart state, then starts Guard.
- `status` gives one-screen health for Supermemory, memory quality, repair watchdog, and Guard.
- `score` gives one confidence number for whether Supermemory memory/retrieval looks trustworthy.
- `status --explain`, `repair --explain`, `verify --explain`, and `start --dry-run --explain` use local Ollama/Llama when available to explain diagnostics in plain English.
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
