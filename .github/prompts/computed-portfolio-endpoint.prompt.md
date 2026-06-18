---
description: "Create a computed portfolio endpoint that returns positions with live prices from the provider fallback chain, derived P&L (no stored redundancy), and portfolio-level aggregation. Use when: building the portfolio API, adding live price display to the UI, or after normalizing the Position schema."
argument-hint: "Include scores, earnings cross-ref, or price only?"
---
Create a computed portfolio endpoint — positions with live prices from the fallback chain, P&L derived at query time, and portfolio-level aggregation.

## What This Replaces
Currently `/api/portfolio/summary` calls Trading212 API directly every time. It returns `currentPrice` and `pnl` as API fields that aren't persisted. The new endpoint reads from the `Position` table and enriches with live data from the provider fallback chain.

## The Computed Model

```
Position (DB)
  → symbol, quantity, avgPrice, provider, lastQuotedAt
  
  + PriceRefreshService.getCurrentPrice(symbol)
  → currentPrice (from MT5→Alpaca→T212→Finnhub→AV→Yahoo fallback)
  
  = ComputedPosition
  → value = currentPrice × quantity
  → pnl = (currentPrice - avgPrice) × quantity
  → pnlPct = pnl / (avgPrice × quantity) × 100
  → allocation = value / portfolioTotalValue
```

## API Design

### `GET /api/portfolio/positions`
```json
{
  "portfolio": {
    "totalValue": 2397.27,
    "totalCost": 3351.28,
    "totalPnl": -954.77,
    "totalPnlPct": -28.5,
    "positionCount": 15,
    "cash": 0.76,
    "providerBreakdown": {
      "trading212": 15
    }
  },
  "positions": [
    {
      "symbol": "NVDA",
      "quantity": 3.91,
      "avgPrice": 219.50,
      "currentPrice": 207.41,
      "priceSource": "alphavantage",
      "priceFresh": true,
      "value": 814.45,
      "pnl": -47.16,
      "pnlPct": -5.5,
      "allocation": 0.34,
      "lastQuotedAt": "2026-06-18T10:00:00Z"
    }
  ],
  "stalePositions": ["8XPd", "PTGEF"],
  "meta": {
    "fetchedAt": "2026-06-18T10:00:01Z",
    "priceProviderChain": ["mt5_offline", "alphavantage", "finnhub"],
    "cacheHitRate": 0.73
  }
}
```

### Optional Query Params
| Param | Default | Purpose |
|-------|---------|---------|
| `?includeScores=true` | false | Attach SEES scores per position |
| `?includeEarnings=true` | false | Attach next earnings date per position |
| `?forceRefresh=true` | false | Skip cache, force provider fetch |

### With Scores + Earnings
```json
{
  "symbol": "NVDA",
  "currentPrice": 207.41,
  "pnl": -47.16,
  "score": {
    "value": 72,
    "signal": "buy",
    "strength": "moderate"
  },
  "nextEarnings": {
    "date": "2026-08-26",
    "daysUntil": 68,
    "epsEstimate": 2.09
  }
}
```

## Implementation

### 1. ComputedPortfolioService
`nest/src/modules/portfolio/computed-portfolio.service.ts`:

```typescript
@Injectable()
export class ComputedPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceRefresh: PriceRefreshService,
    private readonly scoringService: ScoringService,
  ) {}

  async getPositions(options?: { includeScores?: boolean; forceRefresh?: boolean }) {
    const positions = await this.prisma.position.findMany();

    // Fetch all prices in parallel with provider fallback
    const priceResults = await Promise.allSettled(
      positions.map((p) => this.priceRefresh.getCurrentPrice(p.symbol, !options?.forceRefresh))
    );

    const computed = positions.map((p, i) => {
      const priceResult = priceResults[i];
      const currentPrice = priceResult.status === 'fulfilled' ? priceResult.value.price : null;
      const priceSource = priceResult.status === 'fulfilled' ? priceResult.value.source : 'error';

      return {
        symbol: p.symbol,
        quantity: p.quantity,
        avgPrice: p.avgPrice,
        currentPrice,
        priceSource,
        priceFresh: priceResult.status === 'fulfilled' ? priceResult.value.fresh : false,
        value: currentPrice ? currentPrice * p.quantity : null,
        pnl: currentPrice ? (currentPrice - p.avgPrice) * p.quantity : null,
        pnlPct: currentPrice && p.avgPrice ? ((currentPrice - p.avgPrice) / p.avgPrice) * 100 : null,
        allocation: 0, // computed below
        lastQuotedAt: p.lastQuotedAt,
      };
    });

    // Compute allocations
    const totalValue = computed.reduce((s, p) => s + (p.value ?? 0), 0);
    for (const pos of computed) {
      pos.allocation = totalValue > 0 ? (pos.value ?? 0) / totalValue : 0;
    }

    // Optional: attach scores
    if (options?.includeScores) {
      const ranked = await this.scoringService.rankAll(undefined, 200);
      const scoreMap = new Map(ranked.ranked?.map((r: any) => [r.ticker, r]) ?? []);
      for (const pos of computed) {
        const score = scoreMap.get(pos.symbol);
        (pos as any).score = score ? { value: score.score, signal: score.signal, strength: score.strength } : null;
      }
    }

    const totalCost = computed.reduce((s, p) => s + p.avgPrice * p.quantity, 0);
    const totalPnl = computed.reduce((s, p) => s + (p.pnl ?? 0), 0);

    return {
      portfolio: {
        totalValue,
        totalCost,
        totalPnl,
        totalPnlPct: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
        positionCount: computed.length,
      },
      positions: computed,
      stalePositions: computed.filter((p) => !p.priceFresh).map((p) => p.symbol),
    };
  }
}
```

### 2. Controller
```typescript
@Get('portfolio/positions')
async getPositions(
  @Query('includeScores') includeScores?: string,
  @Query('includeEarnings') includeEarnings?: string,
  @Query('forceRefresh') forceRefresh?: string,
) {
  return this.computedPortfolio.getPositions({
    includeScores: includeScores === 'true',
    forceRefresh: forceRefresh === 'true',
  });
}
```

## Benefits
- **No redundant storage** — currentPrice and pnl are always derived
- **Provider fallback** — MT5 first, degrades gracefully through the chain
- **Optional enrichment** — attach scores and earnings on demand
- **Single endpoint** — one call replaces three (portfolio + scores + prices)
- **Cache-aware** — respects the write-threshold from PriceRefreshService

## Related
- `normalize-and-auto-refresh.prompt.md` — PriceRefreshService must exist first
- `import-portfolio-to-positions.prompt.md` — positions must be in the DB

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Computed portfolio endpoint — positions with live prices from provider fallback, derived P&L, optional score/earnings enrichment.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `GET /api/portfolio/positions?includeScores=true&includeEarnings=true&forceRefresh=true`
3. **SYSTEM_SPINE** — Add: `Position (DB) → PriceRefreshService.getCurrentPrice() → ComputedPortfolioService → {currentPrice, pnl, allocation}`
4. **REVISION_LOG** — Add entry: `Computed portfolio endpoint — live prices + P&L derived at query time`
