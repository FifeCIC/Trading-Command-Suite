---
date: 2026-09-09
area: scoring
type: refactor
---

## What Changed

Completed the architectural half of #734 — stopped the two schedulers from running the unscoped, analytics-only `rankAll()` scorer and routed them to read persisted protocol-scoped scores (`score_snapshot` via `rankFromDb()`).

## Files Changed

- `nest/src/modules/scheduler/trading-scheduler.service.ts` — `runScoring()` now calls `rankFromDb()` (reports persisted protocol-score coverage); `generateSuggestions()` now calls `rankFromDb(10)` instead of `rankAll(undefined, 10)`.
- `nest/src/modules/scoring/scoring-scheduler.service.ts` — `executeRun()` now calls `rankFromDb(100)` instead of `rankAll(undefined, 100)`.

## Capability Map Entry

- **name:** Scheduler scoring reads persisted protocol-scoped scores
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Schedulers read persisted scores, not live rankAll
- **procedure:** Confirm `trading-scheduler.service.ts` and `scoring-scheduler.service.ts` no longer reference `rankAll(`; trigger a routine/scheduler run and observe the "scoring"/"suggestions" step detail reports "persisted protocol scores".
- **expected:** No `rankAll(` call remains in either scheduler; suggestions derive from `score_snapshot` (`rankFromDb`), keeping `rankAll()` analytics-only.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Scheduler scoring boundary — `TradingSchedulerService.runScoring`/`generateSuggestions` and `ScoringSchedulerService.executeRun` now read persisted protocol-scoped scores via `ScoringService.rankFromDb()` (score_snapshot) instead of invoking the unscoped, analytics-only `rankAll()` second evaluator. `rankAll()` remains for explicit analytics/QA surfaces only; canonical trade scoring stays on `ProtocolGatingService.scoreWithGating()`. Files: trading-scheduler.service.ts, scoring-scheduler.service.ts.
