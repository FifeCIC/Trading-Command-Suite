# Handoff: SPRINT Batch 5 — Trading UI Consolidation (#562–#567)

**Date:** 2026-08-04
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Implemented 4 changes + investigated 2 large design issues from the Trading area.

## Changes

### #565 — Positions Monitor moved out of Legacy menu
- **File:** `src/core/nav-tree.js`
- **What:** Moved `positions-monitor` from below the "Legacy Strategy Pages" section-header to above it, in the main Trading section (after `strategy-create`)
- **No other changes** — the page itself keeps its current card design (separate A/B/C redesign issue pending)

### #566 — Trading Strategies moved out of Legacy + sortable columns
- **Files:** `src/core/nav-tree.js`, `src/pages/TradingStrategiesPage.jsx`, `src/pages/trading-strategies.css`
- **What:**
  - Moved `trading-strategies` out of Legacy section into main Trading menu
  - Renamed label from "Trading Strategies (old)" to "Trading Strategies"
  - Added `sortKey`/`sortDir` state, `sortedTrading` useMemo, `handleSort`/`sortArrow` helpers
  - Made Symbol, Name, TF, Mode, Active headers clickable with ▴/▾ arrows
  - Table body uses `sortedTrading` instead of `trading`
  - Added `.ts-sortable` CSS with cursor:pointer and accent hover

### #562 — Strategy Monitor: Signals tab
- **Files:** `src/pages/StrategyMonitorPage.jsx`, `src/pages/strategy-monitor.css`
- **What:**
  - Added 4th tab "📡 Signals" to the TABS array
  - Added `signalsData` query to `GET /api/signals/envelope/recent?limit=50` (fetched only when signals tab active)
  - New Signals tab content: header row (Time/Symbol/Score/Signal/Protocol/Strategy) + chronological list
  - Score color-coded: green ≥60, amber ≥40, grey <40
  - Signal color-coded: BUY green, SELL red, HOLD amber
  - Added `.sm-signals-list`, `.sm-signals-header`, `.sm-signal-row` etc. CSS

### #567 — Trading Strategies clarification (NO CODE CHANGE)
- **Finding:** SPRINT.md has two contradictory entries for `/trading/trading-strategies`:
  1. "This is a good view... Move it to the top section... Make columns sortable" — KEEP
  2. "Delete this view" referencing `<th>Active</th>` — DELETE
- **Recommendation:** Entry 1 is more substantial and has been implemented. Entry 2 likely refers to the Active column or was meant for a different view. The page is kept and promoted.

### #563 — Triple Screen redesign (INVESTIGATED)
- Current: `/lab/triple-screen` with 3 placeholder columns
- User wants: two layouts (Pipeline + Widget Grid), 6+ columns, percentage widths, horizontal scroll
- **This is a significant architecture feature.** Needs dedicated design discussion before implementation.

### #564 — Market Context modularize (INVESTIGATED)
- User wants: modularize content → surface on Dashboard + Triple Screen → delete standalone page
- Depends on #563 (Triple Screen) being built first
- **Needs discussion on widget/module architecture.**

## Files Changed
| File | Change |
|------|--------|
| `src/core/nav-tree.js` | Moved positions-monitor + trading-strategies out of Legacy |
| `src/pages/TradingStrategiesPage.jsx` | +sortKey/sortDir state, sortedTrading, sortable headers |
| `src/pages/trading-strategies.css` | +.ts-sortable style |
| `src/pages/StrategyMonitorPage.jsx` | +Signals tab (4th tab) with signals query + render |
| `src/pages/strategy-monitor.css` | +Signals tab styles (.sm-signals-*) |

## Verification
- ✅ Frontend build passes
- ✅ NestJS build unchanged (no backend changes)
