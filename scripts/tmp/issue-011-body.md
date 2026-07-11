## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/lab/charts-lab` — opens with no default data/candles visible. Charts render empty.

### Required Changes
- Load a default symbol and timeframe on page mount
- Show default candles so the page isn't blank on arrival
- Use a sensible default (e.g., EURUSD H1 or most recently viewed symbol)

### Acceptance Criteria
- [ ] Page loads with visible candle data on arrival
- [ ] Default symbol/timeframe is sensible
- [ ] Fallback message if no data source available

### Related
- #225 (Charts Lab completion)
