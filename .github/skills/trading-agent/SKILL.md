---
name: trading-agent
description: "Trading agent skill for the Trading Command Suite. Use when: analyzing portfolio positions, checking earnings dates, cross-referencing holdings with events, running SEES scores, comparing app output with AI analysis, investigating trading opportunities, monitoring positions, or any trading-related query. Encodes knowledge of the full API surface, provider architecture, and trading pipelines."
---
# Trading Agent

## Quick Context
The Trading Command Suite is a React 18 + NestJS trading strategy execution PWA at `C:\wamp64\www\trading-command-suite`. Frontend on `:5173` (Vite), backend on `:3201` (NestJS), MT5 bridge on `:5000` (Python). The app scores assets via the SEES directive system, executes trades via MT5/Trading212, and manages a multi-provider data pipeline.

## API Quick Reference

### Portfolio
```bash
curl http://localhost:3201/api/portfolio/summary        # Positions + account summary
curl http://localhost:3201/api/portfolio/scores          # SEES scores for holdings
curl -X POST http://localhost:3201/api/portfolio/trading212/import  # Fresh import
curl http://localhost:3201/api/portfolio/trading212/validate        # Connection check
curl http://localhost:3201/api/portfolio/trading212/history?days=90 # Trade history
```

### Providers
```bash
curl http://localhost:3201/api/providers/health          # All provider statuses
curl http://localhost:3201/api/providers/rate-limits     # Rate limit states
curl http://localhost:3201/api/providers/quote/NVDA      # Get quote
curl http://localhost:3201/api/providers/candles/NVDA?timeframe=1d&limit=100
```

### Scoring
```bash
curl http://localhost:3201/api/scoring/ranked            # All ranked symbols
curl http://localhost:3201/api/scoring/score/NVDA        # Single symbol score
curl http://localhost:3201/api/directives                 # List directives
```

### Earnings (when wired)
```bash
curl http://localhost:3201/api/earnings/calendar?days=90
curl http://localhost:3201/api/earnings/symbol/NVDA
curl http://localhost:3201/api/portfolio/events?days=30
```

## Provider Architecture

9 providers registered in AdapterFactory with failover priority:
| Priority | Provider | Capabilities | Requires Key |
|----------|----------|-------------|--------------|
| 10 | Alpaca | quotes, candles, profiles | ALPACA_API_KEY |
| 20 | Alpha Vantage | quotes, candles, fundamentals | ALPHA_VANTAGE_API_KEY |
| 30 | Trading212 | quotes, candles, trades, portfolio | TRADING212_API_KEY |
| 40 | MT5 | quotes, candles | MT5 bridge |
| 45 | Polygon | quotes, candles, profiles | POLYGON_API_KEY |
| 50 | Finnhub | quotes, candles, profiles, news, fundamentals | FINNHUB_API_KEY |
| 50 | FMP | quotes, candles, profiles, fundamentals | FMP_API_KEY |
| 55 | Twelve Data | quotes, candles | TWELVE_DATA_API_KEY |
| 60 | Yahoo Finance | quotes, candles, profiles | none |

**Failover**: Rate-limit-aware — picks provider with most remaining calls. Skips tripped providers.

## Trading212 Ticker Decoding
Trading212 uses internal codes:
- `SYM_US_EQ` = US equity → strip to `SYM`
- `SYM_EQ` = Non-US equity → strip to `SYM` (but watch for modifier chars)
- Modifier suffixes: `l` = long/leveraged, `p` = Paris exchange, `d` = unknown
- `3LNVl_EQ` → 3LNV (3x Long NVDA ETP), `AIRp_EQ` → AIR (Airbus Paris)

## Key Files
- Provider adapters: `nest/src/modules/providers/adapters/*.adapter.ts`
- Portfolio: `nest/src/modules/portfolio/portfolio.service.ts`
- Scoring: `nest/src/modules/scoring/scoring.service.ts`
- Directives: `nest/src/modules/directives/implementations/*.directive.ts`
- Diagrams: `src/pages/DiagramsPage.jsx`
- Earnings calendar: `src/pages/EarningsCalendarPage.jsx`
- Accounts dashboard: `src/pages/AccountsDashboardPage.jsx`

## Current Limitations
- Alpha Vantage adapter is **now real** (wired 2026-06-17)
- Backend needs restart to pick up .env changes (use Intranet or `fix-intranet-nestjs-task`)
- EARNINGS_CALENDAR works via CSV parsing in the adapter
- **DataImportHandler not yet built** — use `data-import-handler` prompt to create the unified import system
- Once DataImportHandler exists: earnings, dividends, economic events are tracked in `DataImportLog` table
- Ticker normalization needs mapping table for Trading212 codes
- No portfolio ↔ events cross-reference view exists

## Existing Infrastructure (do NOT rebuild)
- **CacheService** (`nest/src/common/cache/cache.service.ts`) — in-memory cache with TTL, hit/miss stats
- **CacheInterceptor** — auto-caches GET responses, adds X-Cache headers
- **FreshnessService** (`nest/src/modules/market-data/freshness.service.ts`) — evaluates data staleness per symbol+timeframe
- **MarketDataController** — `/api/market-data/freshness` endpoint
- **ImportJobsService** — referenced in controller, may need implementation

## Available Prompts (type `/` in chat)
| Prompt | Purpose |
|--------|---------|
| `data-import-handler` | **CORE**: Unified import system — paginates, tracks freshness, stores ALL data types |
| `trading-session-init` | Load portfolio + scores + earnings in one shot |
| `store-earnings-calendar` | Persist 3-month earnings to DB (uses DataImportHandler once built) |
| `wire-alpha-vantage-earnings` | Already done — adapter is live |
| `fix-trading212-tickers` | Normalize Trading212 instrument codes |
| `build-portfolio-events-view` | Cross-reference holdings with earnings |
| `fix-intranet-nestjs-task` | Register NestJS for start/stop via Intranet |
| `add-diagrams` | Add provider failover + data flow diagrams |
| `normalize-and-auto-refresh` | Fix schema redundancy + PriceRefreshService + page-open trigger |
| `import-portfolio-to-positions` | Import Trading212 → Position table with FK |
| `computed-portfolio-endpoint` | Single endpoint: positions + live prices + P&L + scores |
| `populate-data-tables` | Fill EarningsEvent + AnalystRecommendation tables |
| `add-analyst-forecast-sources` | Finnhub/FMP analyst data + ForecastMergeService |
| `create-data-tables` | Prisma migration for all data storage tables |
| `protocol-risk-gating` | Directive groups (Technical/Sentiment/Risk) with multiplicative gating |
| `portfolio-session-tracking` | Session-over-session comparison + snapshot history |
| `stock-investigation-system` | Persistent stock investigations — findings stored to DB |

## Session Pattern (EFFICIENCY RULES)
**This agent TRADES — it does NOT build. Create prompts for app changes.**

1. **Session start**: Always run `trading-session-init` first — loads everything in parallel
2. **Don't re-explore**: This skill IS the codebase knowledge. Trust it.
3. **Cache API results**: Portfolio data valid 30 min. Don't re-fetch.
4. **Query DB, not APIs**: After data is imported → query tables directly, 0 API calls
5. **Rate limits**: Batch calls only. Single-symbol queries waste tokens AND rate limit slots.
6. **Backend restart**: Use Intranet (once `fix-intranet-nestjs-task` is done). Never brute-force kill PIDs.
7. **Data persistence**: Save session snapshots to Google Drive for cross-session comparison
8. **Discrepancies**: When app output differs from AI analysis, log to session notes — these feed prompts for app improvement
9. **Check freshness first**: `GET /api/data-import/status/earnings` before fetching
10. **📝 Gaps → Prompts**: When the app lacks a capability needed for trading analysis, do NOT build it inline. Instead, identify the gap clearly and reference the relevant prompt from the catalog below. If no prompt exists, create one. The trading agent surfaces needs — dev agents implement them.
