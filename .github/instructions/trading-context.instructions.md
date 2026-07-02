---
description: "Trading context — applies when working with portfolio data, provider adapters, scoring directives, earnings, backtesting, or trading strategies. Use when: modifying trading-related code, building trading features, or analyzing trading data flows."
applyTo: "nest/src/modules/portfolio/**, nest/src/modules/providers/**, nest/src/modules/directives/**, nest/src/modules/scoring/**, src/pages/AccountsDashboardPage.jsx, src/pages/EarningsCalendarPage.jsx, scripts/mt5-bridge/**"
---
# Trading Context Conventions

## Data Flow Rules
1. **Never call external APIs during page rendering.** Adapters are consumed by queue processors and freshness checks.
2. **Portfolio data flows**: Trading212 API → ImportService → PortfolioService → Normalized → Scoring → UI
3. **Provider adapters must never throw.** Return `null` or `[]` on failure and let the caller handle logging.
4. **Rate limits are tracked per-provider.** The AdapterFactory selects the provider with the most remaining calls.

## Ticker Handling
- Trading212 uses internal codes: `SYM_US_EQ` (US) and `SYM_EQ` (non-US)
- Always strip suffixes before cross-referencing with other systems
- Modifier characters (`l`, `p`, `d`) on European tickers indicate instrument variants
- Use `normalizeT212Ticker()` from the ticker map (or `stripTicker()` as fallback)

## Scoring Pipeline
- Directives implement `IDirective` interface → `calculate(input) → DirectiveResult`
- `ScoringService.rankAll()` aggregates all directive scores per symbol
- Calibrations in `seed.ts` adjust weight multipliers per symbol+directive
- The `earnings-proximity` directive currently returns mock-neutral (needs Alpha Vantage wiring)

## Provider Pattern
- Every adapter implements `IProviderAdapter`: `getQuote`, `getCandles`, `getProfile`, `healthCheck`
- Adapters register in `providers.module.ts` with `failoverPriority`
- Lower priority number = preferred provider
- The factory skips rate-limited providers automatically

## Testing
- Mock data is acceptable when `hasCredentials` is false
- Log adapter status (mock vs live) at construction time
- Rate limit tests should verify the factory skips tripped providers

## 🏗️ Architecture Update Rule
**After ANY feature implementation that affects trading subsystems**, file a GitHub Issue with the `revision-log` label. Do NOT edit the Architecture Framework page directly — it is a curated summary, not a change log.

1. **GitHub Issue** — Create a closed issue with label `revision-log` summarizing: what changed, new endpoints, new models, gaps discovered
2. **If a new API endpoint was added** — Add it to `CURRENT_ROUTE_CONTRACTS` in `architecture-framework.data.js` ONLY
3. **If a new Prisma model was added** — Add it to `DATABASE_SCHEMA` in `architecture-framework.data.js` ONLY

⚠️ Do NOT add to STATUS_SNAPSHOT, REVISION_LOG, or KNOWN_GAPS. Those are curated by the Librarian agent, not by feature-development agents. Excessive entries cause token bloat.
