# Handoff — #465 Decision Trail Deep-Links

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#465](https://github.com/FifeCIC/Trading-Command-Suite/issues/465)

## What Changed

### Active Symbols Page
Each symbol row now shows a `🔗 Trail` link that navigates to `/automation/decision-trail?symbol={TICKER}`, pre-filling the symbol filter on the Decision Trail page.

### Positions Monitor
Each CFD position card now shows a `🔗 Trail` link next to the existing `🔍 Details` link, navigating to `/automation/decision-trail?symbol={SYMBOL}`.

### Files Changed
- `src/pages/ActiveSymbolsPage.jsx` — added 🔗 Trail link per symbol row
- `src/pages/PositionsMonitorPage.jsx` — added 🔗 Trail link per position card

### Build Verification
- Vite: `vite build` — 2906 modules, no errors

### Deferred
- Strategy Comparison inspect links (needs #453 real trade data first)
