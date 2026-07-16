---
date: 2026-07-16
area: ui
type: bugfix
---

## What Changed

Verified and closed #319 — Live Ordering Stack page no longer crashes with style prop error. Comprehensive audit of all 250+ style props across `src/` found zero string-based style props. All acceptance criteria verified: page renders in table/card views, handles empty watchlists ("No symbols in this watchlist"), missing data ("No scored data yet"), and API errors (`.catch()` guards on all 5 queries).

## Files Changed

- No code changes required — bug was already resolved by prior work
- Closed GitHub issue #319 with verification summary

## Capability Map Entry

- **name:** Live Ordering Stack
- **persistence:** ephemeral
- **uiSurfaces:** 2
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Live Ordering Stack renders without crash in all states
- **procedure:** Navigate to /scoring/live-ordering-stack with MT5 offline. Select a watchlist with 0 symbols (empty state), then one with symbols (data state). Toggle between Table and Card views. Test with and without auto-refresh.
- **expected:** No "style prop expects mapping" error. Empty watchlist shows "No symbols in this watchlist." Data watchlist shows scored rows/cards. Card view renders correctly. No crashes in any state.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Live Ordering Stack — pairs Watchlist + Protocol via `/api/scoring/gated/batch`, renders scored symbols ranked by composite SEES score. Supports table/card views, auto-refresh (15s), CSV export, keyboard shortcuts, pairing guidance, objectives alignment, and data-quality warnings. File: `src/pages/LiveOrderingStackPage.jsx`. CSS: `scoring-overview.css`. Uses shared hooks from `src/core/api/scoring-hooks.js`.
