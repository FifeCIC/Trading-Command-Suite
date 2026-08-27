---
date: 2026-08-26
area: ui
type: feature
---

## What Changed

Added the Research-area Screener page (epic #682, Phases 4.1 + 4.2 + 4.3 + 4.4). Backend: attention-weight ranking over ScreenerHits with two recency modes (future earnings dates = event proximity; past news = 24h half-life) plus universe transparency counts; news lean (LONG/SHORT/NEUTRAL per story, headline-lexicon fallback because stored pipelines carry no sentiment) + GET /api/screener/stories. Phase 4.4 adds promote-to-watchlist: POST /api/screener/promote (manual, 1:1 screenerHitId provenance, idempotent, creates "Screener" default watchlist on demand) plus per-row protocol-fit counts (SuitabilityService, type inference from slug/style until per-protocol columns exist — #646) and a "My DB only" filter. A follow-up batch closed the Phase 4.3 acceptance gaps: catalyst-TYPE filter chips, a combined symbol-detail panel (catalyst history from GET /api/screener/hits + per-story news lean), and Screen Options column toggles via a new `screener-columns.js` registry (mirrors the symbols-browser pattern; keys `scr-col-*`). Phase 4.1 unit tests landed too: `screener.service.spec.ts` (15 tests) — the decay math was extracted to pure exported helpers (`screenerRecency`, `screenerRawWeight`, `normalizeAttentionWeights`) so both decay modes are DB-free testable; #647 closed against this implementation. Retention cleanup (#690) also shipped: daily 4am prune cron deletes ScreenerHits whose catalyst `timestamp` is older than 30d (env `SCREENER_HIT_RETENTION_DAYS` override), keyed on `timestamp` not `createdAt` so future-earnings hits survive until their date passes, with non-expired watchlist references always preserved; manual trigger at `POST /api/screener/cleanup`; 5 more retention unit tests (20 total); #690 closed with a pre-close checklist. Discussions #692 (news-sentiment signal) and #694 (attention into SEES) got recommendations and await owner decision. Frontend: page with transparency strip, top-picks highlighting (count is a Screen Options setting), sortable table, source filters, Lean column, news stories panel, and a promote panel (existing watchlist, create-new, or default). Attention ≠ conviction — no SEES scores involved.

**AnimatePresence exit-freeze fix (motion 12.40):** the two panels originally used AnimatePresence/motion.section with exit animations; exits froze at `opacity:0` and were never removed, leaving an invisible click-blocking ghost (and a permanently "Adding…"-looking frozen clone). Replaced with plain conditional rendering + CSS-only entrance animation (`.sc-panel-enter`). Do not reintroduce AnimatePresence exits on this page without re-testing DOM removal.

## Files Changed

- nest/src/modules/screener/screener.service.ts — `ranked()`: per-ticker attention weight computed on read (never stored); universe counts (total / hit / quiet); `leanForStory()` + conservative headline lexicon; `stories()` popover data; `promote()`: resolve watchlist (id → find/create by name → default → create "Screener"), 1:1 unique on screenerHitId, appends ticker to watchlist.symbols JSON, returns { promoted | already }; suitability `fitsCount`/`fitsProtocols` via `SuitabilityService.evaluateAll` + `inferProtocolSymbolTypes`; `promotedStatus` from WatchlistItem status; exported pure ranking helpers `screenerRecency` / `screenerRawWeight` / `normalizeAttentionWeights`
- nest/src/modules/screener/screener.service.spec.ts — NEW: 20 unit tests (decay modes, mode precedence, weight composition, relative normalisation, retention helpers)
- nest/src/modules/screener/screener.controller.ts — `GET /api/screener/ranked`, `GET /api/screener/stories`, `POST /api/screener/promote`
- nest/src/modules/screener/screener.module.ts — imports SuitabilityModule
- nest/src/modules/scoring/protocol-gating.controller.ts — added `directionMode` to the no-market-data fallback (fixed TS2741 introduced by #684 GatedScore change)
- src/pages/ScreenerPage.jsx — new page: transparency strip, top picks, sortable table, Lean column, stories panel, filters (incl. My DB only + catalyst-type chips), 250ms poll of `scr-top-picks` + `scr-col-*` column visibility; promote panel (watchlist select, create-new input, useMutation + invalidate `screener-ranked`/`watchlists`, 🔖 status cell, fits ✓ badge); combined symbol-detail panel (catalyst history + news stories); plain conditional panels (see AnimatePresence note above)
- src/pages/screener.css — page styles incl. `.sc-fits`, `.sc-col-action`, `.sc-watch-btn`, `.sc-watching`, `.sc-promote-*`, `.sc-panel-enter` keyframes, `.sc-chip-label`, `.sc-panel-subhead`, `.sc-history-*`
- src/core/screener-columns.js — NEW shared column registry (`scr-col-*` keys) consumed by both ScreenerPage and ScreenOptions so table columns and toggle checkboxes never drift
- src/components/ScreenOptions.jsx — screener registry gains a `tableColumns` section (type `columns`)
- src/core/nav-tree.js — Screener entry in Research nav
- src/core/view-routes.jsx, view-meta.js, page-data-status.js, experience-levels.js — registration
- src/components/ScreenOptions.jsx — `screener` registry: Top Picks Count radio (`scr-top-picks`, 5/10/15/20/25, default 10)
- src/App.jsx — VIEW_TO_OPTIONS mapping
- src/core/view-explanations.js — ℹ explanation

## Capability Map Entry

- **name:** Catalyst Screener (attention-ranked + news lean)
- **persistence:** stored (screener_hit) + ranking/lean computed on read
- **uiSurfaces:** 1
- **pipeline:** both (watchlist promotion implemented in Phase 4.4)
- **completion:** partial (expiry/cleanup of old ScreenerHits pending — see issue filed)

## QA Test Entry

- **area:** Research
- **name:** Screener shows ranked catalysts, news lean + transparency counts, watchlist promotion
- **procedure:** Open /research/screener; confirm top N rows carry 🎯 and the highest Attention values; check the Lean column shows LONG/SHORT/NEUTRAL from headlines; click a row and verify the detail panel lists catalyst history (type/source/strength) and news stories with lean chips and closes fully; toggle the Type chips (e.g. earnings-date) and confirm rows filter; toggle My DB only; click ➕ Watch, pick an existing watchlist or create new, confirm the row shows 🔖 new and the panel is removed from the DOM; change Top Picks Count and Table Columns via gear → Screen Options
- **expected:** Rows ordered by attention weight; top-picks highlight applies immediately; strip shows DB symbols / with catalysts / quiet counts; detail panel renders history + per-story lean; column toggles apply within 250ms; promotion is idempotent (second attempt shows already-promoted state) and the promoted ticker appears in the target watchlist

## Architecture Framework Entry

- **section:** routes
- **summary:** Screener (Research) — /research/screener consumes GET /api/screener/ranked, GET /api/screener/stories, GET /api/screener/hits (catalyst history), POST /api/screener/promote (#682). Ranking theory: attentionWeight = strength × reliability × recency, dual decay (future earnings = 1/(1+daysAway) proximity; past news = 0.5^(hours/24) half-life), computed on read never stored. News lean is per-story LONG/SHORT/NEUTRAL — stored sentiment when present, otherwise a conservative word-boundary headline lexicon (stored pipelines currently carry no sentiment). Universe counts surface filtered-out symbols (transparency requirement, decision 9). Promote writes a WatchlistItem (state machine new→watching→promoted→expired) with unique 1:1 screenerHitId provenance; protocol-fit chips reuse SuitabilityService (type inferred from slug/style until #646 adds per-protocol columns). Files: screener.service.ts, ScreenerPage.jsx.
