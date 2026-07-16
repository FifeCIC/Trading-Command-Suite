---
date: 2026-07-16
area: ui
type: bugfix
---

## What Changed

Verified and closed #312 — Scoring Overview page no longer crashes with "Rendered more hooks than during previous render" error. All hooks (`useQuery`, `usePreferences`, `useDataFreshness`) are called unconditionally at the top of `ScoringOverviewPage()` before any early returns. The `ErrorBoundary` in `App.jsx` line 925 already wraps all rendered content with retry capability.

## Files Changed

- No code changes required — bug was already resolved by prior work
- Closed GitHub issue #312 with verification summary

## Capability Map Entry

- **name:** Scoring Overview Dashboard
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Scoring Overview renders without hooks violation
- **procedure:** Navigate to /lab/scoring-overview. Let it load, then toggle between different pages and return. Check console for "Rendered more hooks" errors.
- **expected:** No hooks errors in console. Page renders summary cards, score distribution, freshness breakdown, protocol card, and top-ranked symbols table. Error boundary catches any render errors and shows retry UI.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Scoring Overview Dashboard — consumes `/api/scoring/ranked` via TanStack Query with 30s auto-refresh. Shows summary cards (symbols scored, avg raw score, avg % of max, pipeline mode), score distribution bar chart (5 buckets), freshness breakdown with signal chips, active protocol configuration, and top-5 ranked symbols table with coverage/freshness indicators. File: `src/pages/ScoringOverviewPage.jsx`. CSS: `scoring-overview.css`. Uses `useDataFreshness` for price refresh and `usePreferences` for table style.
