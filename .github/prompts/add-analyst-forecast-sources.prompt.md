---
description: "Add multi-source analyst price target (low/medium/high) to provider adapters, create a ForecastMergeService that combines them with deviation scoring, implement the AnalystAdjustmentsDirective, and convert PriceForecastPage from mock to real data. Use when: adding analyst forecast data, building forecast-based directives, or making price target data available for portfolio aggregation."
argument-hint: "Which providers to use (finnhub, fmp, alphavantage)?"
---
Add multi-source analyst price target data with merge, deviation, and directive scoring.

## Current State
- `PriceForecastPage.jsx` — **mock data** (14 hardcoded symbols)
- `AnalystAdjustmentsDirective` — registered in module but **implementation file doesn't exist**
- Finnhub adapter — has `getNews`, `getSentiment` but **no price target**
- FMP adapter — has quotes/candles but **no analyst estimates**
- MT5 bridge — has `forecast_value` in economic events but that's macro, not equity

## Data Sources Available

### Finnhub — `/stock/price-target`
```
GET https://finnhub.io/api/v1/stock/price-target?symbol=AAPL&token={key}
```
Returns:
```json
{
  "symbol": "AAPL",
  "targetHigh": 240.00,
  "targetLow": 170.00,
  "targetMean": 205.50,
  "targetMedian": 207.00,
  "lastUpdated": "2026-06-10",
  "numberOfAnalysts": 38
}
```
**Free tier**: 60 calls/min. Key from finnhub.io/register (free, instant).

### FMP — `/price-target`
```
GET https://financialmodelingprep.com/api/v3/price-target?symbol=AAPL&apikey={key}
```
Returns similar: `targetHigh`, `targetLow`, `targetConsensus`, `targetMedian`, `numberOfAnalysts`, `lastMonth`.

### Alpha Vantage — Not available on free tier
(AV's analyst estimates require premium plan)

---

## Implementation

### 1. Add `getPriceTarget()` to Both Adapters

**Finnhub** (`finnhub.adapter.ts`):
```typescript
async getPriceTarget(symbol: string): Promise<PriceTarget | null> {
  this.logger.log(`Finnhub: fetching price target for ${symbol}`);
  const data = await this.finnhubGet<any>(
    `/stock/price-target?symbol=${encodeURIComponent(symbol)}`,
  );
  if (!data || !data.targetMean) return null;
  return {
    symbol,
    source: 'finnhub',
    targetLow: data.targetLow ?? null,
    targetHigh: data.targetHigh ?? null,
    targetMean: data.targetMean ?? null,
    targetMedian: data.targetMedian ?? null,
    numberOfAnalysts: data.numberOfAnalysts ?? null,
    lastUpdated: data.lastUpdated ? new Date(data.lastUpdated) : new Date(),
  };
}
```

**FMP** — same pattern with `/price-target` endpoint.

### 2. Add `PriceTarget` Interface
```typescript
export interface PriceTarget {
  symbol: string;
  source: string;
  targetLow: number | null;
  targetHigh: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  numberOfAnalysts: number | null;
  lastUpdated: Date;
}
```

### 3. Create `ForecastMergeService`
`nest/src/modules/forecast/forecast-merge.service.ts`:

```typescript
export interface MergedForecast {
  symbol: string;
  currentPrice: number | null;
  
  // Consensus across all sources
  consensusLow: number | null;
  consensusMedian: number | null;
  consensusHigh: number | null;
  
  // Per-source breakdown
  sources: Array<{
    provider: string;
    low: number | null;
    median: number | null;
    high: number | null;
    analysts: number | null;
  }>;
  
  // Derived metrics
  totalAnalysts: number;
  sourceCount: number;
  
  // Deviation = confidence signal
  // Tight range = high confidence. Wide range = low confidence → potential short
  deviationPercent: number;  // (high - low) / median * 100
  confidenceLevel: 'high' | 'medium' | 'low';  // <20% high, 20-40% medium, >40% low
  
  upsidePercent: number;  // (median - price) / price * 100
}
```

**Merge logic**:
```typescript
async getForecast(symbol: string): Promise<MergedForecast | null> {
  const targets = await Promise.allSettled([
    this.finnhub.getPriceTarget(symbol),
    this.fmp.getPriceTarget(symbol),
  ]);
  
  const valid = targets
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => (r as PromiseFulfilledResult<PriceTarget>).value);
  
  if (valid.length === 0) return null;
  
  // Consensus = median of medians
  const medians = valid.map((t) => t.targetMedian).filter(Boolean) as number[];
  const lows = valid.map((t) => t.targetLow).filter(Boolean) as number[];
  const highs = valid.map((t) => t.targetHigh).filter(Boolean) as number[];
  
  const consensusMedian = median(medians);
  const consensusLow = median(lows);
  const consensusHigh = median(highs);
  
  const deviationPercent = ((consensusHigh - consensusLow) / consensusMedian) * 100;
  
  return {
    symbol,
    currentPrice: /* from quote */,
    consensusLow, consensusMedian, consensusHigh,
    sources: valid.map((t) => ({...})),
    totalAnalysts: valid.reduce((s, t) => s + (t.numberOfAnalysts ?? 0), 0),
    sourceCount: valid.length,
    deviationPercent: Number(deviationPercent.toFixed(1)),
    confidenceLevel: deviationPercent < 20 ? 'high' : deviationPercent < 40 ? 'medium' : 'low',
    upsidePercent: Number((((consensusMedian - price) / price) * 100).toFixed(1)),
  };
}
```

### 4. Implement `AnalystAdjustmentsDirective`
`nest/src/modules/directives/implementations/analyst-adjustments.directive.ts`:

```typescript
@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';
  readonly name = 'Analyst Adjustments';
  readonly description = 'Scores based on analyst consensus and forecast dispersion. Wide dispersion = low confidence = bearish for longs.';
  readonly priority = 45;
  readonly maxScore = 100;

  constructor(private readonly forecastService: ForecastMergeService) {}

  calculate(input: DirectiveInput): DirectiveResult {
    const forecast = await this.forecastService.getForecast(input.symbol);
    if (!forecast) {
      return { signalClass: 'neutral', score: 50, confidence: 0.1,
        reason: 'No analyst forecast data available' };
    }

    let score = 50; // Start neutral
    const reasons: string[] = [];

    // Upside bonus: >10% upside → bullish
    if (forecast.upsidePercent > 10) {
      score += 15;
      reasons.push(`Strong upside: +${forecast.upsidePercent}%`);
    } else if (forecast.upsidePercent > 5) {
      score += 8;
      reasons.push(`Moderate upside: +${forecast.upsidePercent}%`);
    }

    // Deviation penalty: wide dispersion = uncertainty
    if (forecast.confidenceLevel === 'low') {
      score -= 15;
      reasons.push(`Wide analyst dispersion (${forecast.deviationPercent}%) — low confidence`);
    } else if (forecast.confidenceLevel === 'high') {
      score += 5;
      reasons.push(`Tight analyst consensus (${forecast.deviationPercent}%) — high confidence`);
    }

    // Analyst count: more analysts = more reliable
    if (forecast.totalAnalysts >= 30) {
      score += 5;
      reasons.push(`Strong coverage: ${forecast.totalAnalysts} analysts`);
    } else if (forecast.totalAnalysts < 10) {
      score -= 5;
      reasons.push(`Thin coverage: only ${forecast.totalAnalysts} analysts`);
    }

    return {
      signalClass: score >= 65 ? 'bullish' : score <= 35 ? 'bearish' : 'neutral',
      score: Math.max(0, Math.min(100, score)),
      confidence: forecast.sourceCount >= 2 ? 0.7 : 0.4,
      reason: reasons.join('. '),
      metadata: {
        consensusLow: forecast.consensusLow,
        consensusMedian: forecast.consensusMedian,
        consensusHigh: forecast.consensusHigh,
        deviationPercent: forecast.deviationPercent,
        analysts: forecast.totalAnalysts,
        sources: forecast.sourceCount,
      },
    };
  }
}
```

### 5. Portfolio Aggregation Endpoint
`GET /api/portfolio/forecast`:

```json
{
  "portfolioTotalLow": 1850.00,
  "portfolioTotalMedian": 2450.00,
  "portfolioTotalHigh": 3200.00,
  "portfolioCurrentValue": 2397.27,
  "aggregateUpsidePercent": 2.2,
  "positions": [
    {
      "symbol": "NVDA",
      "currentPrice": 207.41,
      "consensusLow": 180,
      "consensusMedian": 220,
      "consensusHigh": 280,
      "deviationPercent": 45.5,
      "confidenceLevel": "low",
      "upsidePercent": 6.1,
      "shares": 3.91,
      "projectedValueLow": 703,
      "projectedValueMedian": 860,
      "projectedValueHigh": 1095
    }
  ]
}
```

### 6. Convert PriceForecastPage to Real Data
- Replace hardcoded `FORECASTS` array with `apiGet('/api/forecast/ranked')`
- Add deviation column (color-coded: green <20%, yellow 20-40%, red >40%)
- Highlight portfolio positions
- Sort by upside, deviation, or analyst count

---

## What This Enables

| Query | Answer |
|-------|--------|
| "NVDA low/medium/high forecast?" | Low: $180, Median: $220, High: $280 — from 45 analysts across 2 sources |
| "Which holding has widest analyst dispersion?" | NVDA at 45.5% — low confidence, potential short candidate |
| "What's my portfolio's projected value?" | $1,850 (low) / $2,450 (median) / $3,200 (high) |
| "Any stocks with strong upside AND tight consensus?" | Those scoring high on AnalystAdjustmentsDirective |

## API Keys Needed
- **Finnhub**: Free at https://finnhub.io/register (60 calls/min)
- **FMP**: Free at https://financialmodelingprep.com (250 calls/day)

Add to `nest/.env`:
```
FINNHUB_API_KEY=
FMP_API_KEY=
```

## Related Files
- `nest/src/modules/providers/adapters/finnhub.adapter.ts` — add getPriceTarget
- `nest/src/modules/providers/adapters/fmp.adapter.ts` — add getPriceTarget
- `nest/src/modules/providers/interfaces/provider-adapter.interface.ts` — add PriceTarget
- `nest/src/modules/forecast/forecast-merge.service.ts` — NEW: merge across providers
- `nest/src/modules/directives/implementations/analyst-adjustments.directive.ts` — NEW: implement
- `src/pages/PriceForecastPage.jsx` — convert from mock to real API
- `nest/src/modules/portfolio/portfolio.service.ts` — add getPortfolioForecast

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Multi-source analyst forecast system — Finnhub recommendations (free tier), FMP price targets (pending activation), ForecastMergeService with deviation scoring, AnalystAdjustmentsDirective implemented.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `GET /api/forecast/:symbol`, `GET /api/portfolio/forecast`
3. **DATABASE_SCHEMA** — Add PriceTarget model. Note AnalystRecommendation model for Finnhub data.
4. **DOMAINS** — Add: `Analyst forecast aggregation and deviation scoring`
5. **SYSTEM_SPINE** — Add: `Finnhub + FMP → ForecastMergeService → {consensusLow, consensusMedian, consensusHigh, deviationPercent} → AnalystAdjustmentsDirective`
6. **REVISION_LOG** — Add entry: `Analyst forecast sources — Finnhub recommendations + FMP price targets + merge service + directive`
