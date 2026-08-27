---
date: 2026-08-27
area: signals
type: feature
---

## What Changed

Signals feedback loop (#693) — non-executive observability layer that starts validating the ranking and calibrating thresholds:

- **Dismissal analytics**: `signal_dismissal` now stores `combinedStrength`, `signalPct`, `opportunityPct` (what the user saw at dismissal time) and `dismissCount` (increments on repeat dismissals). The Signals page sends the card's strengths on dismiss.
- **Rank snapshots**: new `signal_rank_snapshot` table — the visible best-of ranking is persisted once per hour (rank, symbol, protocol, direction, strengths, score id).
- **Outcome correlation**: no paper assumptions — outcomes come from real `trade` rows with `source='signals'` (won/lost/closed/win-rate, per protocol).
- **`GET /api/signals/analytics`**: returns dismissal totals (by protocol + strength band), real-trade outcomes, and rank validation (avg rank of traded cards vs all cards in the latest snapshot).
- **Signals page**: new collapsible **Signal feedback loop** panel showing the above. Read-only.

## Files Changed

- `nest/prisma/schema.prisma` — SignalDismissal strength/count fields; new SignalRankSnapshot model.
- `nest/src/modules/signals/dto/dismiss-signal.dto.ts` — optional strength fields.
- `nest/src/modules/signals/signal-envelope.service.ts` — dismissal strengths + increment; hourly rank snapshot in `buildBestLadder`; `getAnalytics()`.
- `nest/src/modules/signals/signals.controller.ts` — `GET /api/signals/analytics`; dismiss passes strengths.
- `src/core/api/signals.js`, `src/pages/SignalsOverviewPage.jsx`, `src/pages/signals-overview.css` — panel + dismiss strengths.

## DB Changes (applied manually — prisma db push broken)

- `ALTER TABLE signal_dismissal` — added `combinedStrength`, `signalPct`, `opportunityPct`, `dismissCount`.
- `CREATE TABLE signal_rank_snapshot` (InnoDB, utf8mb4_unicode_ci — collation must match `trade` for joins).

## Capability Map Entry

- **name:** Signals feedback loop (rank validation + dismissal analytics)
- **persistence:** stored
- **uiSurfaces:** 1 (Signals overview panel)
- **pipeline:** signals
- **completion:** complete

## QA Test Entry

- **area:** Signals
- **name:** Feedback loop panel shows dismissal, outcome, and rank data
- **procedure:** Open /signals → expand "Signal feedback loop" → dismiss a card and refresh → dismissal count/band appear; trade a card and check "Signal trades" table updates.
- **expected:** Panel matches real DB state; dismissals store the strength seen at dismissal time; rank snapshots accumulate hourly.

## Architecture Framework Entry

- **section:** routes
- **summary:** New route `GET /api/signals/analytics` (observability). New table `signal_rank_snapshot` (hourly rank persistence) and enriched `signal_dismissal` (strength at dismissal). Non-executive: no trading behaviour is driven by this data yet (#693).
