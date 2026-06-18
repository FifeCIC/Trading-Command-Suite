---
description: "Wire Alpha Vantage EARNINGS_CALENDAR endpoint and convert the Alpha Vantage adapter from mock-only to real API calls. Use when: enabling real earnings data, connecting Alpha Vantage API, adding earnings calendar support to the scoring pipeline."
argument-hint: "API key or configuration details..."
---
Convert the Alpha Vantage adapter from mock-only to real API calls and add the EARNINGS_CALENDAR endpoint.

## Current State
- `nest/src/modules/providers/adapters/alpha-vantage.adapter.ts` — ALL methods return mock data regardless of API key
- `ALPHA_VANTAGE_API_KEY` is recognized in `.env.example` but the adapter ignores it
- The `earnings-proximity` directive says "Mock-first — returns neutral when no earnings calendar data"
- The `EarningsCalendarPage.jsx` uses hardcoded mock data for 10 stocks

## What to Implement

### 1. Convert Adapter to Real API Calls
In `alpha-vantage.adapter.ts`:

- Read `ALPHA_VANTAGE_API_KEY` from env (already done, just unused)
- Add a `hasCredentials` getter
- Replace mock methods with real `fetch()` calls:
  - `getQuote()` → `GLOBAL_QUOTE` endpoint
  - `getCandles()` → `TIME_SERIES_DAILY` or `TIME_SERIES_INTRADAY`
  - `getProfile()` → `OVERVIEW` endpoint
  - `healthCheck()` → call GLOBAL_QUOTE for a known symbol (e.g., AAPL)
- Keep mock fallback when no API key is set
- Add rate limit handling (5 RPM / 500 per day on free tier)

### 2. Add EARNINGS_CALENDAR Method
Add to the adapter (and the IProviderAdapter interface if needed):

```typescript
async getEarningsCalendar(symbol?: string, horizonMonths = 3): Promise<EarningsEvent[]> {
  // GET https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=AAPL&horizon=3month&apikey=...
  // Returns: symbol, name, reportDate, fiscalDateEnding, estimate, currency
}
```

Also add an optional method to get calendar for ALL tracked symbols:

```typescript
async getEarningsCalendarBatch(symbols: string[]): Promise<EarningsEvent[]>
```

### 3. Create EarningsService (NestJS)
Create `nest/src/modules/earnings/earnings.service.ts`:
- Call the adapter's `getEarningsCalendar` method
- Cache results in the database (new `EarningsEvent` Prisma model)
- Normalize dates and estimates across providers
- Feed the `earnings-proximity` directive with real data
- Expose via `EarningsController` at `/api/earnings`

### 4. Update the Earnings Calendar UI
- `EarningsCalendarPage.jsx` should fetch from `/api/earnings/calendar` instead of using hardcoded data
- Filter by date range, sector, symbol
- Highlight portfolio holdings in the calendar

### 5. Wire to Scoring Pipeline
- Update `earnings-proximity.directive.ts` to read from the earnings service
- The directive already handles pre-earnings (1-3 days: uncertainty penalty) and post-earnings (1-3 days: volatility)
- Remove the "mock-neutral" fallback message

## API Key
The user will provide `ALPHA_VANTAGE_API_KEY`. Free tier key from: https://www.alphavantage.co/support/#api-key

## Related Files
- `nest/src/modules/providers/adapters/alpha-vantage.adapter.ts` — main adapter
- `nest/src/modules/providers/interfaces/provider-adapter.interface.ts` — interface
- `nest/src/modules/directives/implementations/earnings-proximity.directive.ts` — scoring directive
- `src/pages/EarningsCalendarPage.jsx` — UI
- `nest/.env.example` — env config

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Alpha Vantage adapter converted from mock to real — GLOBAL_QUOTE, TIME_SERIES_DAILY, OVERVIEW, EARNINGS_CALENDAR (CSV parser). EarningsCalendarPage now has live data path.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `GET /api/earnings/calendar?days=90`, `GET /api/earnings/symbol/:symbol`
3. **SYSTEM_SPINE** — Add: `Alpha Vantage EARNINGS_CALENDAR (CSV) → adapter.getEarningsCalendar() → EarningsService → earnings-proximity directive`
4. **REVISION_LOG** — Add entry: `Alpha Vantage adapter — real API calls + EARNINGS_CALENDAR with CSV parsing`
