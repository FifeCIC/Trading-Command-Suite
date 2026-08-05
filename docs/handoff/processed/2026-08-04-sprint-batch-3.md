# Handoff: SPRINT Batch 3 — Scoring UI Fixes (#551–#556)

**Date:** 2026-08-04
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Implemented 4 fixes + investigated 2 discussion-heavy issues from the Scoring area.

## Changes

### #551 — Protocols counter now counts distinct protocols (not groups)
- **File:** `nest/src/modules/directives/directives.controller.ts`
- **What:** Changed `protocolCount` query from counting raw `protocolDirectiveEntry` rows to counting distinct `protocolId` values via `group.protocolId` join
- **Why:** Old query counted groups, not protocols. A directive in 2 groups of the same protocol would show 2. New query uses `Set<string>` to deduplicate protocolIds.
- **Verified:** All current directives have 0 or 1 protocolCount (data is correct, no duplicates exist)

### #552 — Directive Impact Audit: column alignment + click-to-detail
- **Files:** `src/pages/DirectiveAuditPage.jsx`, `src/pages/directive-audit.css`
- **What:**
  - Fixed flex-based table alignment: `flex: 1` → `flex: 1 1 0` with consistent `min-width` and `box-sizing` across all column types
  - Added `align-items: center` to `.da-tr` for vertical alignment
  - Made directive names clickable links opening in new tab: `<a className="da-name-link" href="/scoring/directive-detail?id=..." target="_blank">`
- **CSS change:** `.da-th-name/NUM/REC/PROTO/ACT` now use `flex: N 1 0` with explicit min-widths for reliable cross-browser alignment

### #553 — Directive Detail: font size +2pt
- **File:** `src/pages/directive-detail.css`
- **What:** Increased all font sizes by ~2pt (~0.14rem):
  - Page base: added `font-size: 0.92rem`
  - h1: 1.3→1.45rem, h2: 0.95→1.05rem
  - Formula: 0.82→0.92rem, meta labels: 0.68→0.76rem, meta values: 0.85→0.92rem
  - Inputs list: 0.78→0.88rem, chips: 0.72→0.82rem
  - JSON: 0.68→0.78rem, test field: 0.7→0.8rem, test input: 0.8→0.88rem

### #554 — Live Ordering Stack: removed watchlist selector
- **Files:** `src/pages/LadderPage.jsx`, `src/pages/scoring-overview.css`
- **What:**
  - Removed watchlist `<select>` from UI — protocol selector only now
  - Watchlist auto-derived from selected protocol's `linkedWatchlists[0]`
  - Shows hint: "📋 Watchlist: {id}" when protocol has a linked watchlist
  - Removed `watchlistId` state, `wlQuery`, `objectives`/`objQuery`, `alignedObjectives` display
  - Updated `pairingGuidance` to use `linkedWatchlistId`
- **CSS:** Added `.los-watchlist-hint` style for the watchlist indicator

### #555 — Signals Workbench (INVESTIGATED — needs discussion)
- The view has: protocol picker, ladder/compare modes, session scan history, stats bar
- Ladder mode sends to `POST /api/signals/ladder` — this endpoint may not return the expected ladder output
- Compare mode shows "HOLD" for all entries — data pipeline may not have fresh signals
- **Recommendation:** Needs discussion on purpose (protocol comparison? signal exploration? scan history?) before code changes

### #556 — SEES Arena (INVESTIGATED — needs discussion)
- Already has tabbed UI (Compare Protocols / Consensus)
- Compare results appear inline below controls, not in persistent tabs
- State persisted to localStorage, not database
- **Recommendation:** Needs DB table for comparison configs + tab lifecycle management. May overlap with A/B testing system design.

## Files Changed
| File | Change |
|------|--------|
| `nest/src/modules/directives/directives.controller.ts` | protocolCount → distinct protocols |
| `src/pages/DirectiveAuditPage.jsx` | clickable directive name links |
| `src/pages/directive-audit.css` | flex alignment fix + .da-name-link |
| `src/pages/directive-detail.css` | all font sizes +2pt |
| `src/pages/LadderPage.jsx` | removed watchlist selector, auto-derive from protocol |
| `src/pages/scoring-overview.css` | +.los-watchlist-hint |

## Verification
- ✅ Frontend build passes
- ✅ NestJS backend build passes
- ✅ API protocolCount now counts distinct protocolIds
