# Supermemory Harness Hackathon Submission

## One-line pitch

Supermemory Harness turns Supermemory Local from a raw local memory server into a recommendable agent-memory product: install once, then users get visible health, project scope, risky-write review, recall proof, repair guidance, and a Local-to-Cloud migration path.

## Why this can beat a flashier demo app

Many hackathon projects show one impressive app that uses memory. Harness improves the Supermemory user experience itself. It makes every app that depends on Supermemory Local easier to trust, debug, demo, and migrate.

The core product bet:

- A user should know within one minute whether Supermemory Local is online, scoped, processing, connected to agents, and safe to rely on.
- An AI coding agent should not guess whether memory is trustworthy before editing code.
- A demo should prove recall with a harmless canary, not only screenshots or vibes.
- A broken local server should produce an exact safe next command, not failed replay loops.
- Useful Local memories should have a reviewed path to Supermemory Cloud.

## Final demo commands

```bash
smctl enhance
smctl recommend
smctl launch
smctl workflow
smctl trust --probe
smctl repair wizard
smctl migrate doctor --redact
```

Short version:

```bash
npm run demo
```

`npm run demo` runs the recommendation pack. It is intentionally read-only and explains why a senior AI engineer or Supermemory developer would recommend Harness as the operational companion for Supermemory Local.

## 90-second judge script

1. Run `smctl recommend`.
   Show the ten must-have feature reasons, senior AI expert view, Supermemory developer view, better user flow, and exact next command.

2. Run `smctl launch`.
   Show the recommendation verdict, launch score, proof checklist, and exact next command.

3. Run `smctl workflow`.
   Explain the before/after: before Harness, users had raw Supermemory logs and had to trust memory blindly; after Harness, they get status, safety, proof, repair, and migration.

4. Run `smctl trust --probe`.
   Prove that memory works with a harmless marker, scoped recall, and search checks.

5. Run `smctl repair wizard`.
   Show that failure cases are part of the product, not hidden. Harness distinguishes Local runtime/server problems from replayable memory writes.

6. Run `smctl migrate doctor --redact`.
   Show the Local-to-Cloud bridge with held items, redaction, project tags, and readiness score.

## What is actually shipped

- `smctl enhance`: one-command activation path.
- `smctl recommend`: ten-feature recommendation pack for senior AI and Supermemory developer review.
- `smctl launch`: final recommendation board for judges, users, and AI agents.
- `smctl executive`: daily/final readiness cockpit.
- `smctl workflow`: simple install-to-trust story and boundaries.
- `smctl watch`: compact Local/agent/memory/Guard activity bar.
- `smctl trust`: Memory Trust Doctor and optional live recall probe.
- `smctl gate`: pre-action governance gate for agents.
- `smctl guard`: risky memory write review.
- `smctl dreams`: Dream Flight Recorder for background memory changes.
- `smctl repair wizard`: ordered, safe recovery plan.
- `smctl memory replay`: guarded failed-write replay.
- `smctl migrate`: reviewed Local-to-Cloud migration with receipts.
- `smctl support`: redacted support bundle.
- `smctl backup`: data-only backup that excludes secrets.
- `smctl audit`: memory hygiene audit for identity, scope, grounding, processing, and retrieval.

## Product angles covered

### User experience

Harness gives one visible command center and one next command instead of requiring users to parse Supermemory server logs.

### AI-agent reliability

Agents get bridge instructions and lifecycle gates so they run memory checks before relying on recalled context.

### Safety

Risky writes are reviewed, obvious secrets are redacted in output, support bundles avoid secrets, and live proof writes are opt-in.

### Recovery

Repair distinguishes Local runtime failure, MCP absence, processing HTTP 500s, schema mismatch, failed documents, retry loops, queue backlog, duplicates, vague memories, and empty recall containers.

### Cloud path

Migration preserves title, content, project/container tags, source anchors, local IDs, local status, timestamps, and content hashes. It holds failed, duplicate, empty, or risky memories until reviewed.

### Demo clarity

`smctl launch` packages the story into a recommendation verdict, launch score, proof checklist, demo script, AI expert brief, and next command.

## If Supermemory Local is broken during judging

Run:

```bash
smctl launch
smctl doctor
smctl repair wizard
```

This is still a valid demo path. The project intentionally shows broken Local state plainly and prevents unsafe replay into a failing processing API.

## Final verification

```bash
npm test
node ./bin/smctl.js --help
node ./bin/smctl.js recommend --limit 5
node ./bin/smctl.js launch --limit 5
```

Expected:

- Tests pass.
- Help lists `launch`.
- `recommend` gives ten must-have feature reasons and the current next command.
- `launch` gives either a recommendable board or a concrete blocker and next command.
