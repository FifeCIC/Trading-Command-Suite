# Handoff — #441 Notification Bell: Merged with DB-Backed Alert System

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#441](https://github.com/FifeCIC/Trading-Command-Suite/issues/441)

## What Changed

### Bell Now Reads from Alert System
The notification bell in ScreenOptions now queries `GET /api/alerts/count` (DB-backed via #440) in addition to its existing provider health and automation status queries.

**Before**: Badge count = provider degradations + automation errors only
**After**: Badge count = provider degradations + automation errors + active DB alerts

This merges the two previously separate notification pipelines — the bell now reflects real alerts created by backend services.

### Files Changed
- `src/components/ScreenOptions.jsx` — added `alertsQuery` to `GET /api/alerts/count`, merged `alertActive` into `totalUnread`

### Build Verification
- Vite: `vite build` — 2907 modules, no errors
