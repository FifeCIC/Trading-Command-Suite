---
date: 2026-07-17
area: scoring
type: feature
---

## What Changed

Created A/B Protocol Testing page (#373) at /lab/ab-testing — side-by-side protocol comparison with signal agreement, divergence analysis, and direction bias visualization.

## Files Changed

- `src/pages/ABTestingPage.jsx` (NEW) — dual protocol selector, watchlist picker, 3-tab view (Signals/Directives/Outcomes), comparison table, divergence cards, direction bias bar
- `src/pages/ab-testing.css` (NEW) — ~250 lines of styling
- `src/core/nav-tree.js` — added ab-testing entry under Lab
- `src/core/view-routes.jsx` — added import + VIEW_COMPONENTS entry
- `src/App.jsx` — added ABTestingPage import

## Capability Map Entry

- **name:** A/B Protocol Testing
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** partial

## QA Test Entry

- **area:** Scoring
- **name:** A/B Protocol Testing compares two protocols side-by-side
- **procedure:** Navigate to /lab/ab-testing. Select a watchlist with symbols. Pick two different protocols. Verify comparison table shows per-symbol scores, signals, delta, and agreement badges. Switch to Directive Analysis tab.
- **expected:** Table shows Protocol A vs B columns with Match/Diverge badges. Agreement rate card shows percentage. Direction bias bar visualizes bullish/bearish split. Divergence cards show largest disagreements.

## Architecture Framework Entry

- **section:** scoring
- **summary:** A/B Protocol Testing (/lab/ab-testing) — runs two protocols against the same watchlist symbols via POST /api/scoring/gated/batch. Computes agreement rate, direction bias (both-bullish, A-only, B-only, both-bearish), and per-symbol score deltas. Three views: Signal Comparison (table), Directive Analysis (divergence cards), Outcome Tracking (placeholder for forward returns). 30s auto-refresh. Files: ABTestingPage.jsx, ab-testing.css.
