---
date: 2026-09-09
area: scoring
type: bugfix
---

## What Changed

Fixed three recurring backend errors that fired on every automation tick:
1. `session-open-effect` threw `barTime.getUTCDay is not a function`.
2. `liquidity-check` threw `bars[i].timestamp.getTime is not a function`.
3. `GlobalDiversificationService` failed to read `global_setting` (invalid `updatedAt`).

## Files Changed

- `nest/src/modules/directives/directives.service.ts` — added `normalizeBarTimestamps()` and call it at the top of `runAll()` (coerces `bars`/`dayBars`/`hourBars`/`min15Bars` timestamps to `Date` before fingerprinting + directive execution).
- `nest/src/modules/directives/market-status.ts` — `computeMarketStatus()` now coerces string timestamps to `Date` (it's also called directly from the automation loop + protocol-gating).

## Why (theory)

`MarketBar.timestamp` is typed `Date`, but some producers (MT5 bridge fallbacks / serialized snapshots) pass ISO strings. Directives that call `.getTime()`/`.getUTCDay()` then throw; `runAll` catches and logs each throw (returning score 0), so the loop kept running while those two directives silently contributed nothing. Normalizing once at the directive boundary (and in `computeMarketStatus`, which is also called outside `runAll`) makes the Date contract real for every consumer.

Separately, two `global_setting` rows (`signal.buy_threshold`, `signal.hold_threshold`) had a zeroed `updatedAt` (`0000-00-00`), which made Prisma's `findMany()` throw "invalid datetime value" — repaired via SQL (`UPDATE ... SET updatedAt = NOW()`).

## Capability Map Entry

- **name:** Directive bar-timestamp normalization (Date contract enforced)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** session-open-effect and liquidity-check no longer throw per tick
- **procedure:** observe backend logs across 2–3 automation ticks
- **expected:** no `Directive session-open-effect threw` / `liquidity-check threw`, and no `GlobalDiversificationService` "invalid datetime" warnings

## Architecture Framework Entry

- **section:** scoring
- **summary:** Directive input now guarantees `Date` bar timestamps — `DirectivesService.runAll()` normalizes all bar timestamps before execution, and `computeMarketStatus()` self-coerces for its direct callers. Eliminates per-tick `getTime/getUTCDay is not a function` errors from string-timestamp producers. Files: directives.service.ts, market-status.ts.
