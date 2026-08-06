# Handoff: TradingStrategyService.create() — Fix silently dropped fields (#589 Phase 1)

**Date:** 2026-08-06  
**Agent:** Copilot (TCS-Dev)  
**Issue:** [#589](https://github.com/FifeCIC/Trading-Command-Suite/issues/589) — Phase 1 DB/UI Contract Audit

## What changed

### `nest/src/modules/trading/trading-strategy.service.ts` — `create()` method

**Before:** `create()` accepted only 10 fields and silently dropped everything else:
- Missing: `description`, `shortProtocolId`, `scoringStrategyId`, `minRarityBand`, `requireDirection`, `useRaritySizing`, `maxSize`, `maxPositions`, `maxDailyLoss`, `cooldownMinutes`, `active`, `hotStockEnabled`, `hotStockAllocation`, `hotStockDetectionMode`, `hotStockMaxHoldHours`
- `active` was hardcoded to `false`, ignoring frontend's `active: true`

**After:** `create()` now accepts all 25 columns on the `TradingStrategy` model. Every field maps to its Prisma column with a sensible default.

```typescript
// New interface — all optional fields accepted
async create(data: {
  name: string; protocolId: string; symbol: string;
  description?: string; brokerId?: string; shortProtocolId?: string;
  scoringStrategyId?: string; timeframe?: string; minComposite?: number;
  minRarityBand?: string; requireDirection?: string; slPct?: number;
  tpPct?: number; baseSize?: number; useRaritySizing?: boolean;
  maxSize?: number; maxPositions?: number; maxDailyLoss?: number;
  cooldownMinutes?: number; mode?: string; active?: boolean;
  hotStockEnabled?: boolean; hotStockAllocation?: number;
  hotStockDetectionMode?: string; hotStockMaxHoldHours?: number;
})
```

## What was NOT changed

- **`update()` method** — already passes `data: Record<string, any>` directly to Prisma. No fix needed.
- **`seedDefaults()`** — uses raw Prisma calls, creates ScoringStrategy with minimal fields. Left as-is for now.
- **`watchlistName`** — frontend `StrategyCreatePage` sends `watchlistName` to TradingStrategy endpoint, but TradingStrategy has no such column. This is a design issue (probably should create a ScoringStrategy first), not a quick fix.
- **`maxPyramidTiers` / `slTpInheritance`** — not sent by any frontend code. Exist only on `ScoringStrategy` model in schema.
- **`hotStock` on ScoringStrategy** — no frontend code references hotStock. Columns exist on TradingStrategy only.
- **Broker config table** — `PROTOCOL_BROKER_MAP` is entirely in-memory in `StrategyCreatePage.jsx`. New table + migration needed.

## Verification

- ✅ Backend build: `tsc -p tsconfig.build.json` — clean
- ✅ Frontend build: `vite build` — clean

## Remaining #589 items

| Item | Status |
|------|--------|
| TradingStrategyService.create() drops fields | ✅ Fixed |
| active hardcoded false | ✅ Fixed |
| maxPyramidTiers/slTpInheritance sent by frontend | ❌ Not actually sent |
| watchlistId sent by frontend | ⚠️ `watchlistName` sent but no column — design issue |
| hotStock on ScoringStrategy | ⚠️ No frontend uses these yet |
| Broker config persistence | ⚠️ Needs new table |
