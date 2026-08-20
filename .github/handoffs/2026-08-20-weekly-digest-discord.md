---
date: 2026-08-20
area: notifications
type: feature
---

## What Changed

Phase 2 weekly digest → Discord (#653). A "This week in Trading Command Suite"
digest compiled from processed handoffs, grouped by area, posted to Discord.
Reuses the phase 1 (#652) pipeline.

## Files Changed

- scripts/weekly-digest-discord.cjs — new. Scans .github/handoffs/processed/
  for the last N days (`--days 7` default, frontmatter/filename date), groups
  by area, and posts one embed: title with week range, change/area counts,
  one field per area with a bullet per change (type, one-line summary, issue
  refs). No handoffs / no webhook → clear skip, exit 0.
- scripts/lib/handoff-parse.cjs — new shared parser (frontmatter, What Changed
  summary, issue refs). Used by both Discord scripts.
- scripts/lib/discord-post.cjs — new shared webhook resolution + delivery
  (DISCORD_WEBHOOK_URL → .env → agent-state.json). Used by both scripts.
- scripts/handoff-to-discord.cjs — refactored onto the shared libs (same
  behaviour, now also treats `bugfix` as a green fix embed).
- .github/workflows/weekly-digest.yml — new. Weekly cron (Mon 09:00 UTC) +
  workflow_dispatch manual trigger; posts via secrets.DISCORD_WEBHOOK_URL.
- package.json — added `digest:discord` npm script.

## Capability Map Entry

- **name:** Weekly digest → Discord
- **persistence:** external (Discord webhook)
- **uiSurfaces:** 0

## QA

- Digest over the real processed dir (mock webhook): "13 changes across 4
  areas — 14 Aug – 16 Aug", fields grouped by area with issue refs (verified).
- No webhook → clear skip message, exit 0 (verified).
- No handoffs in window → skip message (logic; covered by --days short windows).
- Phase 1 script still posts correctly after the refactor (verified).

## Architecture Entries

- Script: scripts/weekly-digest-discord.cjs — owner: Phase 2 weekly digest (#653).
- Script libs: scripts/lib/handoff-parse.cjs, scripts/lib/discord-post.cjs —
  shared Discord pipeline (phases 1–2).
- Workflow: .github/workflows/weekly-digest.yml (weekly cron + manual).
