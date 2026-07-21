---
date: 2026-07-18
area: scoring
type: feature
---

## What Changed

Added time-window deduplication to `OutcomeTrackerService.recordOutcomes()` so the same directive+symbol combination is only recorded once per 5-minute scoring interval. Also added zero-score filtering and a global disable flag. Reduces ~4,500 DB writes per cycle to ~1,000 per tick (one batch per interval, not per poll).

## Files Changed

- `nest/src/modules/scoring/outcome-tracker.service.ts` — Added `OUTCOME_TRACKING_ENABLED` and `OUTCOME_TRACKING_DEDUP_WINDOW_MS` env-configurable constants; added in-memory `lastRecorded` Map for dedup tracking; modified `recordOutcomes()` to filter zero/null scores and skip directive+symbol combos already recorded within the dedup window

## Capability Map Entry

- **name:** OutcomeTracker Time-Window Deduplication
- **persistence:** ephemeral (dedup map in-memory, resets on restart)
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Self-Improvement
- **name:** Outcome dedup reduces writes on repeat scoring runs
- **procedure:** Trigger scoring twice within 5 minutes. Check NestJS logs — first run shows "Recorded N directive outcomes", second run shows "Dedup: N/N outcomes skipped" (all filtered). Check DirectiveOutcome table — no duplicate directive+symbol rows within the same 5-min window.
- **expected:** Second scoring run within 5 min produces 0 new DirectiveOutcome records for same symbols. Zero-score directives excluded. Set `OUTCOME_TRACKING_ENABLED=false` env var → no outcomes recorded at all.

## Architecture Framework Entry

- **section:** scoring
- **summary:** OutcomeTracker dedup — `recordOutcomes()` uses in-memory `Map<"directiveId::symbol", timestamp>` to skip repeat recordings within `OUTCOME_TRACKING_DEDUP_WINDOW_MS` (default 300s). Zero/null scores filtered. `OUTCOME_TRACKING_ENABLED` env var provides global kill switch. Reduces DB churn from ~4,500 writes/poll to ~1,000/interval. File: outcome-tracker.service.ts.
