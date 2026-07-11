# Supermemory Harness

`smctl` is a local developer harness for Supermemory Local. It diagnoses the local install and writes safe integration config so a fresh Supermemory Local user has a clear next step.

## Run

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

## Current Scope

- `doctor` is read-only diagnostics.
- `setup` writes `~/.config/smctl/supermemory.env` and merges Cursor MCP config at `~/.cursor/mcp.json`.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not auto-run Claude Code, Codex, or OpenCode plugin installers yet; it prints the exact next commands instead.
