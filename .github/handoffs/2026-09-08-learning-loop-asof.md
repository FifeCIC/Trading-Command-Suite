---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Closed two META.Stack correctness-review findings:

- **MST-007 (learning loop was dead code):** wired `OutcomeTrackerService.computeOutcomes()`
  into a daily 05:00 cron (`@Cron(CronExpression.EVERY_DAY_AT_5AM)`). Previously nothing
  ever invoked it, so no `DirectiveOutcome` record was ever matured and directive
  "performance"/accuracy stayed permanently empty. (Per-horizon independent maturation
  still needs a schema change — noted as follow-up on #733.)
- **MST-009 (time is implicit):** finished the `asOf` plumbing — `rankAll()` now sets
  `input.asOf`; `computeMarketStatus` now receives the evaluated candle instead of the
  process clock; and the four provider-backed directives (`earnings-momentum`,
  `earnings-proximity`, `insider-activity`, `social-buzz`) now use `input.asOf` for their
  recency windows instead of `new Date()`/`Date.now()`. Replay/live scoring is now
  deterministic for these paths.

## Files Changed

- nest/src/modules/scoring/outcome-tracker.service.ts — added daily maturation cron (MST-007)
- nest/src/modules/scoring/scoring.service.ts — rankAll sets input.asOf
- nest/src/modules/scoring/protocol-gating.service.ts — computeMarketStatus receives asOf
- nest/src/modules/directives/implementations/earnings-momentum.directive.ts — asOf recency window
- nest/src/modules/directives/implementations/earnings-proximity.directive.ts — asOf clock
- nest/src/modules/directives/implementations/insider-activity.directive.ts — asOf cutoff
- nest/src/modules/directives/implementations/social-buzz.directive.ts — asOf cutoff

## Why (theory)

Two instances of the same principle from the correctness review: (1) a pipeline step that
is never wired is not a feature — it is dead code, and a scheduled job is what turns
"records predictions" into "learns from predictions"; (2) the evaluated candle, not the
wall clock, defines scoring time — any directive or service that reads `new Date()` breaks
the promise that replaying the same candles reproduces the same decision.

## Capability Map Entry

- **name:** Directive outcome maturation + deterministic asOf clock
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete (per-horizon maturation deferred)

## QA Test Entry

- **area:** Scoring
- **name:** Outcome maturation cron + asOf plumbing
- **procedure:** `npm --prefix nest run build` (tsc + direction-contract validation pass); confirm no `new Date()` remains in the four provider directives' recency windows
- **expected:** Build clean; cron registered under name `directive-outcome-maturation`

## Architecture Framework Entry

- **section:** scoring
- **summary:** OutcomeTrackerService.computeOutcomes() now runs daily at 05:00 (was dead code); rankAll, computeMarketStatus, and four provider-backed directives now use the evaluated candle (asOf) instead of the process clock. Files: outcome-tracker.service.ts, scoring.service.ts, protocol-gating.service.ts, earnings-momentum/earnings-proximity/insider-activity/social-buzz directives.
