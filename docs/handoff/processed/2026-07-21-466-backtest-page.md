# Handoff — #466 Backtest Page: Move to Training, Days Options, 500 Error Fix

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#466](https://github.com/FifeCIC/Trading-Command-Suite/issues/466)

## What Changed

### a) Moved to Training Nav
- Removed `{ id: 'backtest', ... }` from `research.views` (Development area)
- Added to `training.views` alongside Pattern Detection, Candle Patterns, and MT5 Demo Trading
- Route unchanged (view-based routing, no URL change)

### b) 500 Error Fixed
- `POST /api/backtest/run` controller now wrapped in try/catch
- Returns `{ error: true, message: "..." }` instead of crashing with 500
- Error message surfaced from the exception or a fallback guidance

### c) Shorter Days Options
Added 4 new options to the days dropdown:
| Before | After |
|--------|-------|
| 90, 180, 365, 730, 1825 | **7, 14, 30, 60**, 90, 180, 365, 730, 1825 |

- Default changed from 365 → 30 (more realistic for quick testing, matches MT5 typical range)

### Deferred
- **Symbol autocomplete**: extracting from SignalsWorkbench into a reusable component is non-trivial — needs its own issue
- **News menu → Trading Strategy selector**: deferred until trading/backtesting UIs are unified (per discussion #467)

### Files Changed
- `src/core/nav-tree.js` — moved backtest from Development to Training area
- `src/pages/BacktestPage.jsx` — added 7/14/30/60 day options, default 30
- `nest/src/modules/backtest/backtest.controller.ts` — wrapped run() in try/catch

### Build Verification
- NestJS: `tsc -p tsconfig.build.json` — clean
- Vite: `vite build` — 2908 modules, no errors
