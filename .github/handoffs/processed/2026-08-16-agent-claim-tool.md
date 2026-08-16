---
date: 2026-08-16
area: agents
type: feature
---

## What Changed

Implemented `scripts/agent-claim.cjs` — the issue-claim + server-restart coordination state machine that `.github/prompts/start.prompt.md` (/start) and `.github/agent-state.json` already referenced but was missing. Agents can now claim/release issues with heartbeats, and coordinate dev-server restarts, through a single shared state file.

## Files Changed

- scripts/agent-claim.cjs — NEW. Commands: `status`, `claim <n> "<title>"`, `heartbeat`, `release`, `cache-snapshot`, `server-op start|end [vite|nest|mt5|all]`, `help`. Reads/writes `.github/agent-state.json`. `claim` posts the "🤖 Claimed by" GitHub comment (graceful fallback if `gh` unavailable). `cache-snapshot` renders `gh issue list --json` stdin to `.github/issue-cache/snapshot.md`. `server-op` sets/clears `restartingVite/Nest/Mt5` flags.

## Result

The `/start` flow now works end-to-end with no prompt changes. Duplicate issue claims are refused; stale claims (no heartbeat >15m) are flagged; server restarts can be coordinated so agents don't restart the same service concurrently.

## Capability Map Entry

- **name:** Agent claim / restart coordination
- **persistence:** stored (.github/agent-state.json)
- **uiSurfaces:** 0
- **pipeline:** agents
- **completion:** complete

## QA Test Entry

- **area:** Agents
- **name:** agent-claim.cjs state machine
- **procedure:** Run `status`, `claim`, `heartbeat`, `release`, `server-op start/end`, and `gh issue list --json ... | node scripts/agent-claim.cjs cache-snapshot`.
- **expected:** status reflects claim/heartbeat/snapshot; duplicate claim refused; release clears it; snapshot.md + agent-state.json update correctly; stale heartbeat flagged.

## Architecture Framework Entry

- **section:** agents
- **summary:** New scripts/agent-claim.cjs backs the /start prompt's claim workflow and .github/agent-state.json (claimedIssue + serverOps). Duplicate-issue prevention and dev-server restart coordination now have a working shared state machine. Closes #651.
