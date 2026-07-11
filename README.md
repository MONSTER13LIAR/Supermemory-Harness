# Supermemory Harness

`smctl` is a local developer harness for Supermemory Local. It diagnoses the local install and writes safe integration config so a fresh Supermemory Local user has a clear next step.

## Run

Install and connect Harness:

```bash
node ./bin/smctl.js install
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
- `setup` writes `~/.config/smctl/supermemory.env` and merges Cursor MCP config at `~/.cursor/mcp.json`.
- `smoke` writes a harmless marker document, waits for processing, and searches for it.
- `guard` runs a local review proxy for `POST /v3/documents`, flags risky memory writes, and requires approval before forwarding.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not auto-run Claude Code, Codex, or OpenCode plugin installers yet; it prints the exact next commands instead.
