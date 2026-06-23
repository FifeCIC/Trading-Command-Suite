---
description: "Add the ability to include or exclude news events when backtesting, enabling isolation of protocol performance from news-driven moves. Use when: enhancing backtest realism, testing protocol robustness, or analyzing news impact on strategy performance."
argument-hint: "Exclude all news or specific categories? Both modes?"
appliesTo: "nest/src/modules/backtest/**, nest/src/modules/news/**"
---

# Backtest News Exclusion — Isolate Protocol from News Events

## Problem

Backtests currently run on pure price data — every bar is treated equally. But in reality:
- **FOMC announcements** cause violent 5m moves that no technical directive could predict
- **ETF approval/rejection news** for Bitcoin creates gaps that skew backtest results
- **Major exchange hacks** or regulatory announcements create outlier bars

A backtest that includes these events mixes protocol-driven trades with news-driven noise. To validate the protocol itself, we need to test it both WITH and WITHOUT news-impacted periods.

## Use Cases

| Mode | Purpose |
|------|---------|
| **Include news** | Realistic simulation — how would the protocol actually have performed? |
| **Exclude news** | Protocol purity test — does the scoring work without external shocks? |
| **News-only** | News sensitivity analysis — does the protocol profit FROM news or get killed BY news? |
| **News-weighted** | Reduce position size during known high-impact events |

## Solution

### 1. News Event Calendar

Build or leverage an existing news event database. The system already has `EarningsEvent` in Prisma — extend with a more general `NewsEvent`:

```prisma
model NewsEvent {
  id          String   @id @default(uuid()) @db.VarChar(36)
  symbol      String   @db.VarChar(20)     // "BTC-USD", "*" for market-wide
  category    String   @db.VarChar(30)     // "FOMC", "ETF", "regulation", "exchange", "macro"
  title       String   @db.VarChar(500)
  impact      String   @db.VarChar(10)     // "low", "medium", "high", "extreme"
  occurredAt  DateTime                     // When the event happened
  windowStart DateTime?                    // Optional: pre-event caution window
  windowEnd   DateTime?                    // Optional: post-event digestion window
  source      String?                      // Where this data came from

  @@index([symbol, occurredAt])
  @@index([occurredAt])
}
```

### 2. Data Sources for BTC News

| Source | Cost | Coverage |
|--------|------|----------|
| **CryptoPanic API** | Free tier available | Real-time crypto news with impact ratings |
| **CoinGecko API** | Free | Status updates, exchange incidents |
| **Manual curation** | Time | High-quality, human-verified events |
| **ForexFactory calendar** | Free (scrape) | FOMC, NFP, CPI — macro events that move BTC |

Start with a manual seed of ~50 major BTC events (2022-2026) and add automated feeds later.

### 3. Backtest Integration

Extend `BacktestService` with news-awareness:

```typescript
interface BacktestOptions {
  symbol: string;
  days: number;
  timeframe: string;
  directiveIds?: string[];
  weights?: Record<string, number>;

  // NEW: News handling
  newsMode?: 'include' | 'exclude' | 'reduce-size' | 'news-only';
  newsCategories?: string[];      // ["FOMC", "ETF"] — which categories to apply
  newsWindowMinutes?: number;     // How many minutes around event to apply (default: 60)
  sizeReductionPct?: number;      // For 'reduce-size' mode (default: 80% reduction)
}
```

#### Mode: `exclude`
Skip any trade whose entry bar falls within the news window. The bar is treated as if no trade was entered. This isolates protocol performance from news-driven moves.

```
Bar 1000: Score 85 → BUY signal
  → Check: Is bar 1000 within ±30min of a high-impact news event?
  → YES (FOMC minutes release at bar 1000+2) → SKIP this trade
  → NO → Enter trade normally
```

#### Mode: `reduce-size`
Enter the trade but at reduced size (e.g., 20% of normal). This simulates a cautious approach:
```
Bar 1000: Score 85 → BUY signal
  → Check: Within news window? YES
  → Enter with 0.2 × baseSize instead of full size
```

#### Mode: `news-only`
Only enter trades where a news event is present. This measures the protocol's news-trading capability:
```
Bar 1000: Score 85 → BUY signal
  → Check: Within news window? NO → SKIP
Bar 1005: Score 72 → BUY signal
  → Check: Within news window? YES (ETF approval) → ENTER
```

### 4. Comparative Report

The backtest endpoint should return a comparison when multiple modes are requested:

```json
POST /api/backtest/run
{
  "symbol": "BTC-USD",
  "days": 730,
  "timeframe": "5m",
  "protocolId": "btc-speed-v1",
  "newsModes": ["include", "exclude", "reduce-size"],
  "newsCategories": ["FOMC", "ETF", "regulation"],
  "newsWindowMinutes": 60
}
```

Response:
```json
{
  "symbol": "BTC-USD",
  "comparison": {
    "include": {
      "totalReturn": 42.3,
      "sharpeRatio": 1.8,
      "maxDrawdown": -15.2,
      "winRate": 58.4,
      "totalTrades": 1240
    },
    "exclude": {
      "totalReturn": 38.1,
      "sharpeRatio": 2.1,
      "maxDrawdown": -9.8,
      "winRate": 60.2,
      "totalTrades": 980
    },
    "reduce-size": {
      "totalReturn": 35.7,
      "sharpeRatio": 2.3,
      "maxDrawdown": -7.2,
      "winRate": 61.1,
      "totalTrades": 1240
    }
  },
  "insight": "Excluding news improves Sharpe from 1.8 to 2.1 and reduces drawdown from -15.2% to -9.8%. The protocol performs better without news noise — consider disabling or reducing size during high-impact events."
}
```

### 5. Chart Annotation

When viewing a backtest with news mode, annotate the chart:
- **Red vertical bands** for excluded periods (news windows where trades were skipped)
- **Orange vertical bands** for reduced-size periods
- **Tooltip on hover** showing the news event title and impact

### 6. News Sensitivity Matrix

New endpoint to analyze which news categories affect the protocol most:

```
GET /api/backtest/news-sensitivity?symbol=BTC-USD&protocolId=btc-speed-v1&days=730
```

Returns a matrix:
```json
{
  "categories": {
    "FOMC": { "avgPLImpact": -0.8, "winRateDelta": -12.3, "tradesAffected": 24 },
    "ETF": { "avgPLImpact": 2.1, "winRateDelta": 5.7, "tradesAffected": 8 },
    "regulation": { "avgPLImpact": -3.2, "winRateDelta": -18.1, "tradesAffected": 15 },
    "exchange": { "avgPLImpact": -1.5, "winRateDelta": -8.4, "tradesAffected": 6 }
  },
  "recommendation": "Exclude 'regulation' and 'FOMC' events. Allow 'ETF' events — the protocol profits from them."
}
```

## Implementation Order

1. **Seed BTC news events** — 50 major events, 2022-2026, in a JSON seed file
2. **Create `NewsEvent` Prisma model + migration** — or use existing table structure
3. **Extend `BacktestService`** with `newsMode` parameter
4. **Add comparison endpoint** — run multiple modes in one request
5. **Add chart annotations** — colored bands for news windows
6. **Add sensitivity matrix endpoint** — category-level impact analysis

## References
- Backtest review: `backtest-review-and-btc-testing.prompt.md`
- BTC Theory: `docs/BTC-SPEED-PROTOCOL-THEORY.md`
- Existing backtest prompts: `backtest-all-directives.prompt.md`, `backtest-equity-curve.prompt.md`, `backtest-persistence.prompt.md`
