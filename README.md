# Supermemory Harness

`smctl` is a local developer harness for Supermemory Local. The first shipped command is `smctl doctor`, a read-only diagnostic that checks install shape, local server reachability, API route visibility, API key file shape, and coding-tool integration config presence.

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

## Current Scope

- Read-only diagnostics only.
- Never prints the Supermemory API key or auth secret.
- Does not claim localhost requests validate API-key correctness, because Supermemory Local can auto-apply localhost auth.
- Does not modify Claude Code, Codex, Cursor, or OpenCode config files.
