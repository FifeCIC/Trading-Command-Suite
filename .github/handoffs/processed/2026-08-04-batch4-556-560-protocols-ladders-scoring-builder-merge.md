# Batch 4: Issues #556–#560 — Protocol Disable, Ladders, Scoring Runs, Builder Swap, Strategy Merge

**Date:** 2026-08-04  
**Agent:** Copilot (DeepSeek V4 Pro)  
**Build:** ✅ Frontend (2952 modules) + Backend (tsc) both clean

---

## #556 — Protocol Disable Toggle

### Changes
- **`nest/src/modules/scoring/protocol-gating.controller.ts`**: Added `PATCH /api/scoring/gated/protocols/:id/toggle` endpoint. Toggles protocol `active` status in DB (protocol or strategy table). Reloads protocol cache via `protocolDb.preloadAll()`. Added `Patch` to controller imports.
- **`src/pages/ProtocolsPage.jsx`**: Added Enable/Disable toggle button in the stats grid next to the Status indicator. Calls the PATCH endpoint and refetches on success.
- **`src/pages/protocols-page.css`**: Added `.protocols-toggle-btn` styles — green for enable, red for disable, fills solid on hover.

### Reason
User wanted ability to disable protocols so they no longer appear in interfaces like SEES Arena. Toggle is available on the Protocols page detail view for the selected protocol.

---

## #557 — Ladders Rebuild (→ "Strategies Ladder")

### Changes
- **`src/pages/StrategyLaddersPage.jsx`**: Complete rewrite. Replaced per-strategy card grid with unified ladder table. Features:
  - Toggle: "All Symbols" vs "Signals Only" (signals = BUY/SELL)
  - Sort: By Score (descending) or A–Z
  - Table: Rank #, Symbol, Strategy (with color bar), Signal badge (▲/▼/◆), Score (color-coded)
  - Flattens all arena stacks into a single ranked list
  - Stats bar shows total vs signal counts
- **`src/pages/sees-arena.css`**: Added `.sl-ladder-*` styles — toolbar bar, chip toggles, table, row, signal badges (buy/sell/hold colors).
- **`src/core/nav-tree.js`**: Renamed nav label from "Strategy Ladders" → "Strategies Ladder".

### Reason
User identified that the old per-strategy card grid was confusing — US Indices ladder showed forex pairs, Forex Pairs showed stocks. The unified ladder correctly aggregates all strategies into one ranked view with proper sorting and filtering.

---

## #558 — Delete Scoring Runs + Fix Activity Logs Column

### Changes
- **`src/pages/ScoringRunsPage.jsx`**: File still exists but removed from routing (no longer referenced).
- **`src/core/nav-tree.js`**: Removed `scoring-runs` entry from the Scoring area.
- **`src/core/view-routes.jsx`**: Removed `ScoringRunsPage` import and `'scoring-runs'` entry from VIEW_COMPONENTS.
- **`src/pages/ScoringActivityLogsPage.jsx`**: Split "Protocol / Strategy" column header into separate "Protocol" and "Strategy" columns. Added protocol cell showing `run.protocolName || run.protocolId`. Updated `colSpan` from 4→5.

### Reason
User identified Scoring Runs as a duplicate of Scoring Activity Logs. Deleted from navigation. The column split clarifies which entity is protocol vs strategy.

---

## #559 — Builder Swap (URL/Purpose Clarification)

### Changes
- **`src/core/nav-tree.js`**: Renamed nav labels:
  - `create-protocols`: "Create Protocols" → "Create Protocol" (it IS the protocol builder with DirectivePalette)
  - `strategy-builder`: "Protocol Builder" → "Strategy Builder" (it IS the strategy/scoring strategy builder with groups)
- **`src/pages/StrategyBuilderPage.jsx`**: Updated page title from "Protocol Builder" → "Create Protocol". Added JSDoc clarifying route and purpose.

### Reason
The URL names and labels were misleading — `/scoring/create-protocols` was actually a protocol builder but labeled confusingly, and `/scoring/strategy-builder` was a strategy builder but labeled "Protocol Builder". Labels now match their actual function.

---

## #560 — Strategy Merge (StrategiesListPage → StrategyMonitorPage)

### Changes
- **`src/pages/StrategyMonitorPage.jsx`**: 
  - Added "Strategies" tab (with `◆` icon) showing full strategy cards from StrategiesListPage.
  - Added `stratFilter` state and `filteredStrats`/`faultyStrats` memoized filters.
  - Filter bar: All / Active / Trading / Scoring / Faulty (reuses `.sl-filter-chip` styles).
  - Faulty banner with "View faulty" button.
  - Card grid: Reuses `.sl-card` design from strategies-list.css with dot, type badge, metadata chips, last score, data status warnings, expandable detail.
  - Overview tab: Now shows ALL strategies (removed `.slice(0, 12)` limit).
  - Added `import './strategies-list.css'` for card styles.
- **`src/core/nav-tree.js`**: Removed `strategies-index` entry from Trading area.
- **`src/core/view-routes.jsx`**: Removed `StrategiesListPage` import and `'strategies-index'` entry from VIEW_COMPONENTS.

### Reason
User wanted Strategy Monitor to be the single destination for all strategy viewing. The old Strategies List page is now merged as a tab inside Strategy Monitor, with all filters and the faulty banner preserved.

---

## Files Changed
| File | Change |
|------|--------|
| `nest/src/modules/scoring/protocol-gating.controller.ts` | Added PATCH toggle endpoint + Patch import |
| `src/pages/ProtocolsPage.jsx` | Added Enable/Disable toggle button |
| `src/pages/protocols-page.css` | Added `.protocols-toggle-btn` styles |
| `src/pages/StrategyLaddersPage.jsx` | Complete rewrite — unified ladder with signals toggle |
| `src/pages/sees-arena.css` | Added `.sl-ladder-*` table/toolbar styles |
| `src/pages/ScoringActivityLogsPage.jsx` | Split Protocol/Strategy columns, added protocol cell |
| `src/pages/StrategyMonitorPage.jsx` | Added Strategies tab, filters, faulty banner, full card grid |
| `src/pages/StrategyBuilderPage.jsx` | Renamed title, added JSDoc |
| `src/core/nav-tree.js` | Removed scoring-runs & strategies-index; renamed labels |
| `src/core/view-routes.jsx` | Removed ScoringRunsPage & StrategiesListPage imports/entries |
