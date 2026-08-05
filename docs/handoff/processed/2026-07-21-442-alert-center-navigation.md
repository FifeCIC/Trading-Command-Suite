# Handoff — #442 Alert Center: Click Navigation

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#442](https://github.com/FifeCIC/Trading-Command-Suite/issues/442)

## What Changed

### Alert Card Click Navigation
Clicking an alert card now navigates to the relevant view instead of just marking it read:
- **Ticker present** → navigates to `/research/symbol/{ticker}`
- **Link present** → opens the URL
- **No ticker/link** → fallback by alert type:
  - `signal` → `/scoring/live-ordering-stack`
  - `drawdown` → `/trading/portfolio-overview`
  - `backtest` → `/training/backtest`
  - `system` → `/status/status`
  - `daily` → `/dashboard`

Alert is still marked as read on click.

### Files Changed
- `src/pages/AlertCenterPage.jsx` — added `useNavigate`, `TYPE_FALLBACKS` map, `handleAlertClick` function, updated card onClick

### Build Verification
- Vite: `vite build` — 2906 modules, no errors

### Deferred
- Backend: add optional `ticker` and `link` fields to Alert model + populate in unified pipeline
