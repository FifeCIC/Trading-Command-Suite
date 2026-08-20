---
date: 2026-08-20
area: scoring
type: feature
---

# Protocol scoring status — honest Active/Stalled/Paused/Disabled states

## Problem
Protocols set to Active could silently not score (no symbols configured, no market
data, non-ready directives) and views showed rows of dashes with no explanation.
Worse, the automation loop early-returned when there were no positions/strategies,
so protocol-driven scoring never ran at all in that state.

## What changed

### Backend
- **`protocol_score_status` table** (bootstrap DDL + Prisma model): loop-owned
  runtime state per protocol. States: `scoring | no-symbols | no-data | paused | error`.
  Row absent = pending; `active=0` derives `disabled`.
- **Automation loop** (`automation-loop.service.ts`):
  - REMOVED the early-return on empty `allSymbols` — protocol scoring (step 3b)
    now runs every tick; step 4 (strategy evaluation) is gated on the working set.
    This restores live protocol scoring when there are 0 positions/strategies.
  - Persists one status row per active protocol each tick (upsert + prune).
- **`protocol.note` column** (bootstrap ALTER + Prisma model): human-readable
  state explanation, e.g. why a protocol is parked. Surfaced by
  `GET /api/scoring/gated/protocols` and the new status endpoint.
- **`GET /api/scoring/gated/protocols/status`** (`protocol-gating.controller.ts`):
  merges registry config (active, note) with loop status rows for all protocols.
- `ProtocolDbService.getAllProtocols` now reads `note` alongside `active`.

### Frontend
- **`src/core/protocol-status.js`** — app-wide shared mechanism:
  `PROTOCOL_STATUS_META`, `buildProtocolStatus(protocol, statusRow)`, and the
  `useProtocolStatuses()` hook. Any protocol view should derive its badge from
  this — never from dashes or the `active` flag alone.
- **`ProtocolsLadderPage.jsx`** — new Status column (Active/Stalled/Paused/
  Pending/Disabled chips with reason tooltip), stall reasons replace dashes in
  the Highest Scorer cell ("no data", "not configured"), a "· N stalled"
  counter in the toolbar, and a Disabled section at the bottom listing parked
  protocols with their notes (+ link for no-note ones).
- **`protocols-ladder.css`** — chip variants `pl-status-ok/warn/bad/muted`,
  `pl-stall-reason`, disabled-section styles.

### Data changes (nest/scripts/protocol-notes-2026-08-20.cjs)
- Disabled + noted: `eurusd-macro-v1`, `usdjpy-risk-v1`, `gbpusd-news-v1`
  (parked 2026-08-20 pending framework/news work).
- Noted only: `signals-workbench` (sandbox; kept active — it's not on the
  ladder because it has no directive groups).

## Verification
- Status endpoint live: xau-* + gold-macro + forex-session = `scoring`;
  spy-*/qqq-*/vix-spike = `no-data`; parked three = disabled with notes.
- Ladder shows "12 protocols · 5 stalled", stall reasons, and the parked three
  with notes under Disabled.
- Live protocol scoring restored (forex-session-v1 7/7 scored on tick).

## Follow-ups
- #665 — bar refresh doesn't cover protocol symbols (root cause of `no-data`).
- #666 — phase 5: protocol states as first-class errors via messaging.
- #623 — stale-score metadata; updated with concrete stale-bar examples.

## Architecture entries (for reference framework)
- Route contract: `GET /api/scoring/gated/protocols/status` — owner:
  Protocol scoring status (2026-08-20). Returns `{ statuses, count }` with
  per-protocol `{ protocolId, name, active, note, status|null }`.
- Component contract: `<ProtocolsLadder />` now displays loop-owned status
  chips via `buildProtocolStatus` (src/core/protocol-status.js).
