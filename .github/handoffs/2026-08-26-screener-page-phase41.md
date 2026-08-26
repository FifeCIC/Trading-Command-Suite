---
date: 2026-08-26
area: ui
type: feature
---

## What Changed

Added the Research-area Screener page (epic #682, Phase 4.1 + 4.3). Backend: attention-weight ranking over ScreenerHits with two recency modes (future earnings dates = event proximity; past news = 24h half-life) plus universe transparency counts. Frontend: page with transparency strip, top-picks highlighting (count is a Screen Options setting), sortable table, and source filters. Attention ≠ conviction — no SEES scores involved.

## Files Changed

- nest/src/modules/screener/screener.service.ts — `ranked()`: per-ticker attention weight computed on read (never stored); universe counts (total / hit / quiet symbols)
- nest/src/modules/screener/screener.controller.ts — new `GET /api/screener/ranked`
- nest/src/modules/scoring/protocol-gating.controller.ts — added `directionMode` to the no-market-data fallback (fixed TS2741 introduced by #684 GatedScore change)
- src/pages/ScreenerPage.jsx — new page: transparency strip, top picks, sortable table, filters, 250ms poll of `scr-top-picks`
- src/pages/screener.css — page styles
- src/core/nav-tree.js — Screener entry in Research nav
- src/core/view-routes.jsx, view-meta.js, page-data-status.js, experience-levels.js — registration
- src/components/ScreenOptions.jsx — `screener` registry: Top Picks Count radio (`scr-top-picks`, 5/10/15/20/25, default 10)
- src/App.jsx — VIEW_TO_OPTIONS mapping
- src/core/view-explanations.js — ℹ explanation

## Capability Map Entry

- **name:** Catalyst Screener (attention-ranked)
- **persistence:** stored (screener_hit) + ranking computed on read
- **uiSurfaces:** 1
- **pipeline:** both (watchlist promotion in a later phase)
- **completion:** partial (Phases 4.2 news lean, 4.4 promotion, 4.5 handoff pending)

## QA Test Entry

- **area:** Research
- **name:** Screener shows ranked catalysts + transparency counts
- **procedure:** Open /research/screener; confirm the top N rows carry 🎯 and have the highest Attention values; change Top Picks Count via the gear → Screen Options; compare the strip counts against GET /api/screener/ranked
- **expected:** Rows ordered by attention weight; top-picks highlight matches the chosen count and applies immediately; strip shows DB symbols / with catalysts / quiet counts

## Architecture Framework Entry

- **section:** routes
- **summary:** Screener (Research) — /research/screener consumes GET /api/screener/ranked (#682). Ranking theory: attentionWeight = strength × reliability × recency, dual decay (future earnings = 1/(1+daysAway) proximity; past news = 0.5^(hours/24) half-life), computed on read never stored; universe counts surface filtered-out symbols (transparency requirement, decision 9). Files: screener.service.ts, ScreenerPage.jsx.
