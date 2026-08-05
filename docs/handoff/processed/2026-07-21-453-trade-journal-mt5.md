# Handoff — #453 Trade Journal: Wire to Real MT5 History

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#453](https://github.com/FifeCIC/Trading-Command-Suite/issues/453)

## What Changed

### Replaced empty journal API with real MT5 trade data
- **Before**: queried `/api/journal/entries` — always returned 0 entries
- **After**: queries `GET /api/providers/mt5/history?limit=500` — real deal history from MT5 bridge

### Data mapping
- `mapDealToEntry()` converts MT5 deal format to journal entries
- P&L = profit + commission + swap
- Origin tagged as 'manual' (has comment) or 'mt5'
- Stats computed client-side from real data: win rate, avg win/loss, best/worst day

### Fixed hardcoded currency
- Changed from hardcoded `£` to dynamic `$` (MT5 is USD-denominated)
- All price/P&L displays use `currencySymbol` variable

### Standardized API client
- Replaced raw `fetch()` calls with `apiGet()` / `apiPost()` from the project's API client
- Removed broken `editingNote` state and `handleAddNote` (endpoint didn't exist)

### Files Changed
- `src/pages/TradeJournalPage.jsx` — replaced journal API with MT5 history, dynamic currency, stats from real data

### Build Verification
- Vite: `vite build` — 2907 modules, no errors
