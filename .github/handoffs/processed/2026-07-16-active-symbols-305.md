# Active Symbols — Company Names + Column Toggles (#305 & #299)

**Date:** 2026-07-16
**Issues:** #305 and #299 (duplicate)

## What Already Existed
- Open Trade column (● Open with position count)
- P/L column (color-coded +/-)
- Protocols column (count)
- Multi-select rows → Create Watchlist workflow
- Portfolio positions query and directives query for data

## What Was Added

### 1. Company Name as Primary Identifier
- Replaced the two-column "Ticker" + "Name" layout with a single "Name" column
- Shows company name (`sym.name`) as the primary clickable link
- When company name differs from ticker, shows ticker as monospace subtitle underneath
- When company name equals ticker (no company data in DB), shows ticker + "No company name" note

### 2. Column Visibility Toggles
- New "⚙ Columns" dropdown button in the Symbols section header
- Checkboxes for: Open Trade, P/L, Protocols, Exchange, Type
- Persisted to `localStorage` under key `tcs:active-symbols:columns`
- Defaults: all columns visible
- Pattern: `loadCols()` / `saveCols()` helper functions + `useState` + `toggleCol` callback

## Files Changed
| File | Change |
|------|--------|
| `src/pages/ActiveSymbolsPage.jsx` | Added `useEffect`, `useCallback` imports; `loadCols`/`saveCols`/`DEFAULT_COLS` constants; `cols` state + `showColOptions` state + `toggleCol`; replaced Ticker+Name columns with single Name column showing company name + ticker subtitle; wrapped Open Trade/P/L/Protocols/Exchange/Type columns in conditional `{cols.key && (...)}` rendering; added Columns dropdown button |
| `src/pages/trading-platforms.css` | Added `.tp-col-options-dropdown`, `.tp-col-option`, `.tp-col-option input[type="checkbox"]` styles |
