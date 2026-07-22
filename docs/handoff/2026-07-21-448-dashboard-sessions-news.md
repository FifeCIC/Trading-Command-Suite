# Handoff — #448 Dashboard: Market Sessions Popover & News Sentiment Fix

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#448](https://github.com/FifeCIC/Trading-Command-Suite/issues/448)

## What Changed

### Market Sessions Popover
- Each market session row (London, New York, Tokyo) now shows a hover popover with:
  - Market name and current status (Open/Closed)
  - Trading hours with timezone (e.g. "08:00–16:00 (GMT/BST)")
  - GMT offset (e.g. "+1")
  - Countdown to next open or close (e.g. "Closes in 3h 15m")
- Implemented as CSS hover popover (`.dash-session-hoverable:hover .dash-session-popover`) positioned above the session row
- TZ labels added to session data: London → GMT/BST, New York → ET, Tokyo → JST

### News & Sentiment — Unverified Status Fix
- **Before**: Used `GET /api/providers/health` which returned `status: "unknown"` for Finnhub/FMP, showing misleading "Unverified" even with 2000+ articles in the DB
- **After**: Uses `GET /api/news/counts` which returns actual article counts per source
- Shows `"{N} articles"` in green for sources with articles, `"Unverified"` in grey for empty sources
- Summary line shows total article count across sources

### New Backend Endpoint
- **`GET /api/news/counts`**: Returns `{ counts: { finnhub: N, fmp: N, ... }, total: N }`
  - Counts articles per source (NewsSource.name) from the last 30 days
  - Added `getSourceCounts()` method to `NewsImportService`

### Files Modified
- `src/pages/DashboardPage.jsx` — replaced provider health query with news counts query; market session popovers; news section rewrite
- `src/pages/HomeDashboard.css` — added `.dash-session-hoverable`, `.dash-session-popover`, popover title/row styles
- `nest/src/modules/news/news-import.service.ts` — added `getSourceCounts()` method
- `nest/src/modules/news/news.controller.ts` — added `GET /api/news/counts` endpoint

### Build Verification
- NestJS: `tsc -p tsconfig.build.json` — clean
- Vite: `vite build` — 2905 modules, no errors
