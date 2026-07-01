# RUI013 — Data Elements: Replace Demo Data with Real Pipeline

**Agent:** tcs-dev
**Area:** Data
**Priority:** P2 — data integrity
**Depends on:** Default watchlist, MarketBar data, SEES pipeline

## Problem

`DataElementsPage.jsx` shows "COMPLETE" status with 163 symbols — this is hardcoded demo logic. The status should reflect real data availability per symbol per element.

## Task

### Phase 1: Real Status Logic
- Replace `ELEMENTS` constant's hardcoded status logic with real queries
- Each element = prerequisite check: "does this symbol have the data required for this directive?"
- Query `MarketBar` table for OHLCV bar counts, freshness per symbol
- Only show "Complete" when actual required data exists

### Phase 2: Default Watchlist Integration
- Use the default watchlist symbols as the test set (not all 163)
- The testing mechanism must mirror what SEES uses in automation
- Real data from active providers flows through the normal pipeline

### Phase 3: Element Applicability
- Not all elements apply to all symbols (crypto elements don't apply to stocks)
- Add symbol type gating per element
- Show element coverage as "X of Y applicable symbols complete"

### Important
- Don't restructure the view — the element card display is good
- Only fix the fake status data and symbol count
