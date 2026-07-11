# Supermemory Harness

`smctl` is the Supermemory Harness CLI: a local companion plugin for Supermemory Local. It installs safe integration config, checks memory health, adds Guard review, and can set up Smart Assist from one guided terminal flow.

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

The commands below are optional diagnostics and advanced controls.

Show every command:

```bash
smctl help
```

Check the full Harness state:

```bash
smctl status
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
node ./bin/smctl.js smoke
```

Inspect memory quality and failed ingests:

```bash
node ./bin/smctl.js memory doctor
node ./bin/smctl.js memory replay
node ./bin/smctl.js memory replay --apply
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

Enable Smart Assist separately if you skipped it during install:

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
- `status` gives one-screen health for Supermemory, memory quality, and Guard.
- `setup` writes `~/.config/smctl/supermemory.env` and merges Cursor MCP config at `~/.cursor/mcp.json`.
- `smoke` writes a harmless marker document, waits for processing, and searches for it.
- `memory doctor` checks failed documents, queued backlog, duplicate titles, memory-agent failures, and sampled memory entries.
- `memory replay` safely resubmits failed text documents after provider/config issues are fixed.
- `skillset` installs local app-specific memory policies used by Guard.
- `skills` installs markdown memory behavior skills: write hygiene, query patterns, and context injection format.
- `smart` can use a provider env var or a hidden terminal prompt; prompted keys are stored in a local `0600` Harness secret file.
- `guard` runs a local review proxy for `POST /v3/documents`, adds active project/skillset metadata, flags risky memory writes, and requires approval before forwarding.
- Smart Assist is optional; Harness core skills and Guard enrichment work without provider API access.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not auto-run Claude Code, Codex, or OpenCode plugin installers yet; it prints the exact next commands instead.
