# Handoff — Strategy Profit/Runtime Ratio (#343) — 2026-07-29

## What Changed
Added profit efficiency metrics to both strategy views.

### Strategy Dashboard (`StrategyDashboardPage.jsx`)
- Added `runDurationMs` to the card data model (raw ms from automation status)
- Added **P&L/day** metric card: `pnl / (runDurationMs / 86400000)`
- Shows `—` when runtime < 1 day
- Color-coded green/red matching existing P&L metric

### Strategy Comparison (`StrategyComparisonPage.jsx`)
- Added **P&L/Trade** column to the showdown table (between Total P&L and Avg Win)
- Formula: `totalPnl / trades`
- Shows `—` when no trades recorded
- Color-coded green/red

## Files Changed
- `src/pages/StrategyDashboardPage.jsx` — +1 data field, +1 metric card
- `src/pages/StrategyComparisonPage.jsx` — +1 header column, +1 data cell

## Verification
- Vite build: **zero errors**
- Both ratios computed client-side from already-available data — no backend changes needed

## Related
- Closes #343
