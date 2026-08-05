# Handoff — #451 Dashboard P&L Broker Naming, LIVE/PRACTICE Labels, Zero-Balance Cleanup

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#451](https://github.com/FifeCIC/Trading-Command-Suite/issues/451)

## What Changed

### Broker Naming
| Before | After |
|--------|-------|
| `MT5` | `MetaQuotes (MT5)` |
| `Trading 212` | `Trading212` |
| `Stocks ISA` | `Trading212 Stocks ISA` |

### LIVE/PRACTICE Badges
- MT5: shows `PRACTICE` badge (blue). Mode detection from `diag.mode` not yet available in backend — defaults to practice. Backend upgrade needed.
- Trading212: shows `LIVE` (green) or `PRACTICE` (blue) based on `t212Query.data?.mode` from `/api/portfolio?source=trading212`
- ISA: always shows `LIVE` (green) — ISA accounts are live-only

### "DEMO" → "PRACTICE"
- MT5 badge text changed from `DEMO` to `PRACTICE`
- Trading212 badge changed from `GIA` to `LIVE`/`PRACTICE`
- ISA badge changed from `ISA` to `LIVE`
- New CSS class `.badge-practice` (blue, matches old `.badge-demo` styling)

### Zero-Balance Practice Accounts Hidden
- MT5 row hidden when `mt5Mode === 'practice'` AND `pnlByBroker.mt5.pnl === 0`
- Trading212 row hidden when `t212Mode === 'practice'` AND `pnlByBroker.t212.pnl === 0`
- ISA always shows (it's live)
- Total "All Brokers" row always shows

### Portfolio Summary Clarified
- Renamed from "Portfolio Summary" to "MT5 Portfolio Summary" to make it clear this section only shows MT5 data

### Files Changed
- `src/pages/DashboardPage.jsx` — mode variables, Portfolio Summary rename, P&L section rewrite
- `src/pages/HomeDashboard.css` — added `.badge-practice` style

### Build Verification
- Vite: `vite build` — 2906 modules, no errors

### Known Limitation
- MT5 mode defaults to `practice` because `diag.mode`/`diag.login` is not exposed by `/api/providers/mt5/diagnostics`. When the backend adds this field, update the `mt5Mode` variable.
