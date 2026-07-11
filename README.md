# Supermemory Harness

`smctl` is a local developer harness for Supermemory Local. It diagnoses the local install and writes safe integration config so a fresh Supermemory Local user has a clear next step.

## Run

Install and connect Harness:

```bash
npm install -g github:MONSTER13LIAR/Supermemory-Harness
smctl install
```

That same command works on macOS, Linux, and Windows PowerShell when Node.js 22+ and npm are installed.

For local development from this repo:

```bash
node ./bin/smctl.js install
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

Optionally enable env-based Smart Assist:

```bash
smctl smart enable
smctl smart enable --yes
smctl smart enable --api-key-env LLM_API_KEY --yes
smctl smart doctor
```

`smart enable` can use `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` directly. For custom env names, pass `--api-key-env`; Harness infers OpenAI, Gemini, or Anthropic from the key shape and asks for `--provider` only when it cannot infer safely.

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
- `status` gives one-screen health for Supermemory, memory quality, and Guard.
- `setup` writes `~/.config/smctl/supermemory.env` and merges Cursor MCP config at `~/.cursor/mcp.json`.
- `smoke` writes a harmless marker document, waits for processing, and searches for it.
- `memory doctor` checks failed documents, queued backlog, duplicate titles, memory-agent failures, and sampled memory entries.
- `memory replay` safely resubmits failed text documents after provider/config issues are fixed.
- `skillset` installs local app-specific memory policies used by Guard.
- `smart` optionally stores a reference to an existing provider env var; it never copies the API key.
- `guard` runs a local review proxy for `POST /v3/documents`, flags risky memory writes, and requires approval before forwarding.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not auto-run Claude Code, Codex, or OpenCode plugin installers yet; it prints the exact next commands instead.
