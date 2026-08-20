---
date: 2026-08-20
area: notifications
type: feature
---

## What Changed

Phase 1 Discord activity (#652) — a standalone script that posts a short Discord
embed when a handoff file is processed/closed. Foundation for the social
pipeline (phase 2 weekly digest → Discord, phase 3 Reddit/Facebook, phase 6
changelog umbrella).

## Files Changed

- scripts/handoff-to-discord.cjs — new. Parses a handoff markdown (frontmatter
  date/area/type, first paragraph of "What Changed", issue # references),
  builds a Discord embed, and POSTs to the webhook. Webhook resolution order:
  `DISCORD_WEBHOOK_URL` env → repo `.env` → `.github/agent-state.json`
  (discordWebhookUrl). No webhook → clear skip message, exit 0.
- .github/agents/librarian.agent.md — handoff processing step 7 now includes
  "Notify Discord" per processed file (close handoff → notify Discord).
- package.json — added `handoff:discord` npm script.

## Capability Map Entry

- **name:** Handoff → Discord activity
- **persistence:** external (Discord webhook)
- **uiSurfaces:** 0

## QA

- No webhook configured → prints "⏭ Discord webhook not configured — skipping
  post." and exits 0 (verified).
- Configured webhook (mock server on localhost) → POSTs a valid embed with
  title "Handoff closed · scoring — feature", date, one-line summary, and
  issue numbers #623, #665, #666 extracted from the handoff (verified).
- Missing handoff file → clear error + exit 1 (verified).

## Architecture Entries

- Script: scripts/handoff-to-discord.cjs — owner: Phase 1 Discord activity (#652).
- Env contract: DISCORD_WEBHOOK_URL (shared with nest notifications
  DiscordChannel).
