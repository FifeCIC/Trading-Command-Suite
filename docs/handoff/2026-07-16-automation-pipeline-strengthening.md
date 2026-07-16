# Handoff — Automation Pipeline Strengthening (2026-07-16)

## Agent
DeepSeek V4 Pro (primary agent)

## Summary
Two rounds of optimization on the automation tick pipeline.

### Round 1: Performance (4 changes)
Reduced tick time from ~20-47s → **2.1s** (~15× faster) and enabled immediate trading on startup.

### Round 2: Trade Frequency (3 changes)
Reduced tick interval from 5min → **2min**, replaced global cooldown with **per-symbol cooldown**, enabling up to 11 trades per tick instead of 1.

## Changes Made

### Round 1

#### 1. Immediate First Tick on Startup
**File:** `nest/src/modules/automation/automation-loop.service.ts` — `start()` method
**Change:** Added `this.tick().catch(...)` after interval setup so the first tick fires immediately instead of waiting 5 minutes.

#### 2. rankAll() Symbol Filter
**File:** `nest/src/modules/scoring/scoring.service.ts` — `rankAll()` method
**Change:** Added optional `symbolFilter?: string[]` parameter. When provided, only scores those symbols instead of ALL active DB symbols (~30).
**File:** `nest/src/modules/automation/automation-loop.service.ts` — Step 3
**Change:** Passes `strategySymbols` to `rankAll()`.

#### 3. Gated Score Cache (Step 3b ↔ Step 4)
**File:** `nest/src/modules/automation/automation-loop.service.ts`
**Change:** Added `gatedScoreCache: Map<string, GatedScore>` field. Step 3b populates it, step 4 reads via `getGated()` helper.

#### 4. Strategy Grouping by Symbol (Step 4)
**File:** `nest/src/modules/automation/automation-loop.service.ts` — Step 4 & `evaluateStrategy()`
**Change:** Step 4 groups active strategies by symbol, fetches bars once per symbol, passes pre-fetched bars to `evaluateStrategy()` via new `preFetchedBars` parameter.

### Round 2

#### 5. Per-Symbol Cooldown (Replaces Global Cooldown)
**File:** `nest/src/modules/automation/automation-loop.service.ts`
**Change:** Added `lastSymbolTrade: Map<string, number>` for per-symbol 60s cooldown. The old global `lastAnyTradeAt` 60s cooldown was replaced with per-symbol checks in all 4 dispatch paths (step 3b, evaluateStrategy ×2, confirmAction). A short 3s global safety cooldown remains for race-condition prevention.
**Impact:** Previously only 1 trade could execute per tick regardless of how many symbols had strong signals. Now each symbol can trade independently — up to 11 trades per tick.

#### 6. Reduced Tick Interval: 5 min → 2 min
**File:** `nest/src/modules/automation/automation-loop.service.ts` — `state.tickIntervalMs`
**Change:** `300000` → `120000`
**Impact:** 30 ticks/hour instead of 12. Combined with per-symbol cooldown, trade frequency potential increased ~15× (from 1 trade/5min to 11 trades/2min theoretical max).

## Results Verified (Round 1)
- Tick time: 2,141ms (was ~20,000-47,000ms)
- Ticks: immediate first tick
- MT5 positions: 4 (USDJPY, USDCAD, XAUUSD, GBPUSD)
- New trades: GBPUSD, XAUUSD

## Results Verified (Round 2)
- Tick time: **1,098ms** (further improvement)
- Tick interval: **120,000ms** (2 min)
- MT5 positions: **5** (new: EURUSD + USDCAD in same tick)
- **Multi-symbol trades per tick confirmed** — EURUSD and USDCAD both executed in the same tick, impossible before with global cooldown

## Files Modified
1. `nest/src/modules/automation/automation-loop.service.ts`
   - Added `gatedScoreCache`, `lastSymbolTrade` fields
   - `start()`: immediate first tick
   - `tick()`: gatedScoreCache.clear(), filtered rankAll, getGatedScore helper, symbol-grouped step 4
   - `evaluateStrategy()`: added `preFetchedBars` parameter, `getBars()` and `getGated()` helpers
   - All 4 dispatch paths: per-symbol cooldown + 3s global safety
   - `tickIntervalMs`: 300000 → 120000
2. `nest/src/modules/scoring/scoring.service.ts`
   - `rankAll()`: added optional `symbolFilter` parameter

## Related Pending Work
- **FreshnessService** still checks all ~30 DB symbols — scoping to strategy symbols would reduce noise
- **Step 3b and Step 4** still have partially overlapping dispatch logic — could be unified
- **Duplicate guard** may allow multiple positions on same symbol from different protocols — verify this is intentional
- **US500 "No score available"** — investigate why this strategy has no data
- Consider parallelizing symbol scoring with `Promise.all()` for further speed gains (currently 1s tick is already fast)

