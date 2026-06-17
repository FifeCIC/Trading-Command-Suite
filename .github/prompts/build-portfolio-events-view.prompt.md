---
description: "Build a Portfolio Events view that cross-references portfolio holdings with upcoming earnings, dividends, and economic events. Use when: checking what's coming up for your positions, building calendar cross-reference views, or answering 'which of my holdings has earnings next?'"
argument-hint: "Event types to include..."
---
Build a Portfolio Events Cross-Reference view that answers "what's coming up for my holdings?"

## Problem
The app has portfolio data (via Trading212 import) and will have earnings data (via Alpha Vantage), but there's no view that connects them. Users manually cross-reference.

## What to Build

### 1. Backend: Portfolio Events Endpoint
New endpoint: `GET /api/portfolio/events?days=30`

Response:
```json
{
  "holdings": 15,
  "upcomingEvents": [
    {
      "symbol": "NVDA",
      "ticker": "NVDA_US_EQ",
      "position": { "shares": 3.91, "value": 814, "allocation": 0.34 },
      "events": [
        {
          "type": "earnings",
          "date": "2026-08-15",
          "time": "After Close",
          "epsEstimate": 0.68,
          "revenueEstimate": "35.1B",
          "daysUntil": 59,
          "surpriseHistory": [8.2, 12.5, 5.1, 9.8]
        }
      ]
    }
  ],
  "nextEarnings": { "symbol": "NVDA", "date": "2026-08-15", "daysUntil": 59 },
  "noData": ["8XPd", "PTGEF", "ACIC"]
}
```

### 2. Frontend: Portfolio Events Panel
Add to `AccountsDashboardPage.jsx` or as a new page at `/trading/portfolio-events`:

**Layout:**
- Top: Summary bar — "Next: NVDA earnings in 59 days | 5 events in next 30 days"
- Timeline view: horizontal bar showing the next 3 months with events marked
- Table: Holdings with event columns
  - Symbol | Position Value | Allocation | Next Earnings | Days | EPS Est | Dividend Date
- Color-coded urgency: red = within 7 days, yellow = within 30, green = 30+
- Filter: event type (earnings, dividends, splits, economic)

### 3. Wire to Existing Systems
- Use `PortfolioService.getPortfolio()` for positions
- Use `EarningsService` (from the Alpha Vantage prompt) for earnings dates
- Use `ScoringService.rankAll()` to overlay SEES scores on holdings
- Use the `earnings-proximity` directive to flag pre/post earnings risk

### 4. Alert Integration (Future)
- Show a badge in the top bar when an earnings event is within 3 days
- Color-code the position row based on earnings proximity score
- Link to the strategy engine to suggest pre-earnings adjustments

## Navigation
Add to nav-tree under Trading area:
```js
{ id: 'portfolio-events', label: 'Portfolio Events' }
```

## Related Files
- `nest/src/modules/portfolio/portfolio.service.ts` — add getEvents method
- `nest/src/modules/portfolio/trading212-portfolio.controller.ts` — add events endpoint
- `src/pages/AccountsDashboardPage.jsx` — add events panel
- `src/core/nav-tree.js` — add navigation entry
