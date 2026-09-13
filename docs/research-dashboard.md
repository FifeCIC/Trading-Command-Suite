# Research Dashboard — How It Works

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-07-02
**Last updated:** 2026-07-02
**Owner:** TCS team


## Overview

The Research Dashboard aggregates data from 7+ subsystems into a single overview page. It provides a bird's-eye view of your trading environment: portfolio health, market context, top signals, sector performance, recent decisions, upcoming events, and position news.

## Architecture

```
ResearchOverviewService.getOverview()
    ├── fetchTopSignals()      → Score table (latest per symbol)
    ├── fetchPortfolio()       → Position table + EarningsEvent cross-reference
    ├── fetchMarketContext()   → MacroIndicator table (VIX, Fed, 10Y, Gold, Oil, SPX)
    ├── fetchRecentDecisions() → Recent trades/decisions
    ├── fetchUpcomingEvents()  → Scheduled events affecting positions
    ├── fetchPositionNews()    → News articles for held symbols (sentiment scored)
    └── fetchSectorPerformance() → Sector ETF performance data
```

All fetchers run in parallel via `Promise.all`.

## Key Components

### ResearchOverviewService (`nest/src/modules/research/research-overview.service.ts`)

Single aggregation service — one `getOverview()` call returns everything.

### InvestigationService (`nest/src/modules/research/investigation.service.ts`)

Deep-dive per-symbol analysis:
- Finnhub quote (price, change, high/low)
- News (20 articles with sentiment parsing)
- Social sentiment (Reddit/Twitter mentions)
- Analyst price targets (high/low/mean/consensus)
- **Conviction score (0-100)**: news sentiment (30pts) + analyst upside (25pts) + social buzz (20pts) + article volume (15pts) + price momentum (10pts)

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/research/overview` | Aggregated dashboard (7 subsystems) |
| `GET /api/research/earnings/calendar` | Finnhub earnings (3-month horizon) |
| `GET /api/research/analyst/targets` | Multi-symbol analyst targets with sorting |
| `POST /api/research/investigations` | Deep-dive: quote + news + social + analysts |
| `GET /api/research/investigations` | List stored investigations |
| `GET /api/research/investigations/:id` | Single investigation with conviction score |

### Cron Imports

- **Daily (07:00)**: Earnings calendar import
- **Weekly (Sunday 08:00)**: Analyst targets import

## Market Context

Market context values come from the `MacroIndicator` table:

| Indicator | Source |
|-----------|--------|
| VIX | CBOE Volatility Index |
| Fed Funds Rate | Federal Reserve |
| US 10Y Yield | Treasury |
| Gold | XAU/USD |
| Crude Oil | WTI |
| S&P 500 | Index level |

## UI Features

The Research Overview page (`/research/research-overview`) has 8 panels:

1. **Portfolio**: Position count, total value, P&L, individual positions with earnings warnings (📅 icon)
2. **Market Context**: 6 indicators in a grid — VIX (inverted coloring), Fed Rate, 10Y, Gold, Oil, S&P 500
3. **Top Signals**: Ranked signals from scoring pipeline with BUY/HOLD/SELL tags
4. **Sectors**: ETF performance with color-coded percentage changes
5. **Recent Decisions**: Automated decision log with symbol, composite score, reason
6. **Upcoming Events**: Scheduled events affecting held positions
7. **Position News**: News articles for held symbols with sentiment indicators (🟢/🔴/⚪)

Auto-refreshes every 30 seconds.
