---
date: 2026-09-08
area: scoring
type: refactor
---

## What Changed

Closed MST-010 (option 1): kept `ScoringService.rankAll()` as the screener (opportunity
ranking) but drew a hard, documented boundary so it can no longer be mistaken for a trade
decision source. Concretely:

- `rankAll()` now carries a full purpose contract: SINGLE PURPOSE (rank symbols by additive
  opportunity score), explicit INPUTS (`strategyId?`, `limit`, `symbolFilter?`, `protocolSlug?`),
  OUTPUT (`RankedResult`, no persistence/queue/trade), and a ⚠️ BOUNDARY (legacy second evaluator;
  trade/queue/replay/backtest MUST use `ProtocolGatingService`; never derive BUY/SELL from it).
- The trading scheduler's `generateSuggestions` no longer derives `'BUY (paper)'` from the
  non-canonical `rankAll` score — its `action` is now a display tier (`TOP/WATCH/LOW (screen)`),
  documented as screening-only so it cannot be read as an execution instruction. (Actual trade
  execution already goes through `AutomationLoopService.tick()` → the canonical path.)
- `PortfolioService.getPortfolioScores()` documented as display-only (rankAll, not a signal).

## Files Changed

- nest/src/modules/scoring/scoring.service.ts — rankAll purpose/inputs/outputs/boundary contract
- nest/src/modules/scheduler/trading-scheduler.service.ts — suggestions relabelled as screening
- nest/src/modules/portfolio/portfolio.service.ts — getPortfolioScores documented display-only

## Why (theory)

A function that has drifted to mean several things is untestable. rankAll's job is narrow —
"order the watchlist by opportunity" — and anything else (turning a score into a BUY, enqueuing a
decision) is a different responsibility that belongs to the canonical evaluator. Making the
contract explicit in the signature's doc block is what lets it be unit-tested for exactly one
behaviour and nothing else. This mirrors the wider lesson: define a function/class/module's single
purpose + inputs/outputs, then test only that.

## Capability Map Entry

- **name:** rankAll analytics-only boundary
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** rankAll does not emit trade actions
- **procedure:** `npm --prefix nest run build`; inspect trading-scheduler suggestions `action` values
- **expected:** Build clean; `action` is `TOP/WATCH/LOW (screen)`, never `BUY`/`SELL`

## Architecture Framework Entry

- **section:** scoring
- **summary:** ScoringService.rankAll() is now explicitly documented as analytics-only (screening/opportunity ranking) with a boundary that forbids deriving trade decisions from it; the trading scheduler's suggestions are relabelled to screen tiers rather than trade actions. File: scoring.service.ts, trading-scheduler.service.ts.
