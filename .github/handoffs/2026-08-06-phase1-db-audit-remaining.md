# Handoff: #589 Phase 1 — Remaining DB/UI Contract Fixes

**Date:** 2026-08-06
**Agent:** Copilot (TCS-Dev)
**Issue:** [#589](https://github.com/FifeCIC/Trading-Command-Suite/issues/589)

## Changes

### 1. `nest/src/modules/trading/trading-strategy.service.ts` — `create()`

**Auto-create ScoringStrategy when watchlist provided:**
- Added `watchlistId` and `watchlistName` to the accepted fields
- When either is provided AND `scoringStrategyId` is NOT, the method now auto-creates a `ScoringStrategy` record with: `protocolId`, `watchlistName`, `watchlistId`, `brokerId`, `mode`, `tradeThreshold`, `baseSize`, `slPct`, `tpPct`, `enabled: true`
- If a ScoringStrategy already exists for that protocolId + watchlistName combo, it reuses it
- The auto-created ScoringStrategy's ID is used as `scoringStrategyId` on the TradingStrategy
- This fixes the "watchlistId silently dropped" bug — watchlists now actually get linked

### 2. `src/pages/CreateStrategyPage.jsx` (old page)

**Removed ScoringStrategy fields from TradingStrategy payload:**
- `maxPyramidTiers` and `slTpInheritance` are ScoringStrategy columns, NOT TradingStrategy columns
- They were being sent to `/api/trading/strategies` (TradingStrategy) where Prisma silently dropped them
- Now excluded from the body. The form fields remain for future ScoringStrategy creation flow.
- Note: the old page still sends `watchlistId` which is now properly handled by the backend auto-create logic

## Remaining #589 items

| Item | Status |
|------|--------|
| TradingStrategyService.create() drops fields | ✅ Fixed |
| active hardcoded false | ✅ Fixed |
| maxPyramidTiers/slTpInheritance sent to wrong endpoint | ✅ Fixed (removed from payload) |
| watchlistId silently dropped | ✅ Fixed (auto-creates ScoringStrategy) |
| hotStock on ScoringStrategy | ⏸️ No frontend uses these yet — skip |
| Broker config persistence | ⏸️ Needs `broker_config` table + migration + admin UI |

## Verification

- ✅ Backend build: `tsc -p tsconfig.build.json` — clean
- ✅ Frontend build: `vite build` — clean

## Flow now

```
Old CreateStrategyPage (Protocol path):
  POST /api/trading/strategies { protocolId, watchlistId, ... }
  → TradingStrategyService.create()
    → scoringStrategyId not provided, watchlistId IS provided
    → Auto-creates ScoringStrategy with that watchlist
    → Creates TradingStrategy with scoringStrategyId linked
```

```
New StrategyCreatePage (Score mode):
  POST /api/trading/strategies { protocolId, watchlistName, ... }
  → TradingStrategyService.create()
    → scoringStrategyId not provided, watchlistName IS provided
    → Auto-creates ScoringStrategy with that watchlist
    → Creates TradingStrategy with scoringStrategyId linked
```
