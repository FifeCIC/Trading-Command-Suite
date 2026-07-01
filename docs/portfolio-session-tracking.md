---
description: "Create a portfolio session-over-session comparison system — store snapshots on each session, compare current vs previous values, show deltas per position and portfolio-wide. Use when: the computed portfolio endpoint exists, or when building trend/performance tracking."
argument-hint: "Snapshot frequency (per session, daily, weekly)?"
---
Build session-over-session portfolio comparison — "NVDA is +$47 since yesterday, Portfolio +3.2% this week."

## What This Enables

Instead of a flat "NVDA at $207.41," the agent can say:

```
📊 Portfolio — June 18, 2026
  Value: $2,412 (+$15 / +0.6% since yesterday)
  
  NVDA: $209.12  (+$1.71 / +0.8%)  ← 3.91 shares
  MSTR: $126.04  (+$1.46 / +1.2%)  ← 1.30 shares
  RBLX: $48.12   (-$0.65 / -1.3%)  ← 8.17 shares
  
  📅 MSTR earnings in 42 days (Jul 30, EPS $52.04)
  🎯 SEES: NVDA 72 (buy), RBLX 50 (hold)
```

## Data Model

### PortfolioSnapshot Table
```prisma
model PortfolioSnapshot {
  id              String   @id @default(uuid()) @db.VarChar(36)
  snapshotType    String   @db.VarChar(20)  // 'session', 'daily', 'weekly'
  totalValue      Float
  totalCost       Float
  totalPnl        Float
  totalPnlPct     Float
  positionCount   Int
  cash            Float?
  providerSummary Json     // { trading212: 15, mt5: 0 }
  takenAt         DateTime @default(now())

  positions       PortfolioSnapshotPosition[]

  @@index([snapshotType, takenAt])
}

model PortfolioSnapshotPosition {
  id           String   @id @default(uuid()) @db.VarChar(36)
  snapshotId   String   @db.VarChar(36)
  symbol       String   @db.VarChar(20)
  quantity     Float
  avgPrice     Float
  currentPrice Float
  value        Float
  pnl          Float
  pnlPct       Float
  allocation   Float

  snapshot     PortfolioSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)

  @@index([snapshotId, symbol])
}
```

> **Why store currentPrice in the snapshot?** Unlike the live `Position` table where price is derived, the snapshot is a historical record. You need to know what the price WAS at that moment. This is not redundancy — it's an audit trail.

## API

### `POST /api/portfolio/snapshot?type=session`
Takes a snapshot of the current portfolio state. Called automatically by `trading-session-init`.

```json
{
  "snapshotId": "abc-123",
  "takenAt": "2026-06-18T10:00:00Z",
  "totalValue": 2412.50
}
```

### `GET /api/portfolio/snapshot/compare?against=previous`
Compares current (live computed) portfolio with a previous snapshot.

```json
{
  "current": {
    "totalValue": 2412.50,
    "totalPnl": -938.78,
    "takenAt": "2026-06-18T10:00:00Z"
  },
  "previous": {
    "totalValue": 2397.27,
    "totalPnl": -954.77,
    "takenAt": "2026-06-17T17:00:00Z",
    "snapshotType": "session"
  },
  "deltas": {
    "totalValueChange": 15.23,
    "totalValueChangePct": 0.64,
    "totalPnlChange": 15.99,
    "hoursSinceLastSnapshot": 17
  },
  "positions": [
    {
      "symbol": "NVDA",
      "currentPrice": 209.12,
      "previousPrice": 207.41,
      "priceChange": 1.71,
      "priceChangePct": 0.82,
      "pnlChange": 6.68
    }
  ]
}
```

### `GET /api/portfolio/snapshot/trend?days=7`
Returns snapshot history for trend visualization.

```json
{
  "snapshots": [
    { "date": "2026-06-12", "totalValue": 2300, "totalPnl": -1050 },
    { "date": "2026-06-13", "totalValue": 2350, "totalPnl": -1000 },
    ...
  ],
  "trend": {
    "direction": "up",
    "weekChange": 112.50,
    "weekChangePct": 4.9
  }
}
```

## Implementation

### SnapshotService
```typescript
@Injectable()
export class PortfolioSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly computedPortfolio: ComputedPortfolioService,
  ) {}

  async takeSnapshot(type: 'session' | 'daily' | 'weekly' = 'session') {
    const { portfolio, positions } = await this.computedPortfolio.getPositions();

    const snapshot = await this.prisma.portfolioSnapshot.create({
      data: {
        snapshotType: type,
        totalValue: portfolio.totalValue,
        totalCost: portfolio.totalCost,
        totalPnl: portfolio.totalPnl,
        totalPnlPct: portfolio.totalPnlPct,
        positionCount: portfolio.positionCount,
        positions: {
          create: positions.map((p) => ({
            symbol: p.symbol,
            quantity: p.quantity,
            avgPrice: p.avgPrice,
            currentPrice: p.currentPrice ?? 0,
            value: p.value ?? 0,
            pnl: p.pnl ?? 0,
            pnlPct: p.pnlPct ?? 0,
            allocation: p.allocation,
          })),
        },
      },
      include: { positions: true },
    });

    // Keep only last 30 daily, 12 weekly snapshots
    await this.pruneSnapshots(type);

    return snapshot;
  }

  async compare(against: 'previous' | 'yesterday' | 'week_start' = 'previous') {
    const current = await this.computedPortfolio.getPositions();
    
    const previous = await this.prisma.portfolioSnapshot.findFirst({
      where: { snapshotType: 'session' },
      orderBy: { takenAt: 'desc' },
      include: { positions: true },
    });

    if (!previous) return { current, previous: null, deltas: null };

    // Build price map from previous snapshot
    const prevPriceMap = new Map(
      previous.positions.map((p) => [p.symbol, p])
    );

    const positionDeltas = current.positions.map((pos) => {
      const prev = prevPriceMap.get(pos.symbol);
      if (!prev) return { symbol: pos.symbol, status: 'new' };
      return {
        symbol: pos.symbol,
        currentPrice: pos.currentPrice,
        previousPrice: prev.currentPrice,
        priceChange: (pos.currentPrice ?? 0) - prev.currentPrice,
        priceChangePct: prev.currentPrice > 0 
          ? (((pos.currentPrice ?? 0) - prev.currentPrice) / prev.currentPrice) * 100 
          : 0,
        pnlChange: (pos.pnl ?? 0) - prev.pnl,
      };
    });

    // Detect removed positions
    const currentSymbols = new Set(current.positions.map((p) => p.symbol));
    const removedPositions = previous.positions
      .filter((p) => !currentSymbols.has(p.symbol))
      .map((p) => ({ symbol: p.symbol, status: 'closed', realizedPnl: p.pnl }));

    return {
      current: { totalValue: current.portfolio.totalValue, totalPnl: current.portfolio.totalPnl },
      previous: { totalValue: previous.totalValue, totalPnl: previous.totalPnl, takenAt: previous.takenAt },
      deltas: {
        totalValueChange: current.portfolio.totalValue - previous.totalValue,
        totalValueChangePct: previous.totalValue > 0 
          ? ((current.portfolio.totalValue - previous.totalValue) / previous.totalValue) * 100 
          : 0,
        totalPnlChange: current.portfolio.totalPnl - previous.totalPnl,
        hoursSinceLastSnapshot: (Date.now() - previous.takenAt.getTime()) / 3600000,
      },
      positions: [...positionDeltas, ...removedPositions],
    };
  }
}
```

## Session Flow

```
trading-session-init
  → POST /api/portfolio/snapshot?type=session    // Snapshot current state
  → GET /api/portfolio/snapshot/compare?against=previous  // Compare to last
  → Display deltas in session output
```

## 📊 Data Split Architecture

This prompt builds on the existing data split design. Each piece of data has its own storage, timestamp, and freshness rules:

| Data Piece | Storage | Timestamp | Freshness Rule |
|------------|---------|-----------|----------------|
| Stock price | `MarketBar` | `timestamp` | Check `PriceRefreshService`: MT5=60s, AV=per-call |
| Position (cost) | `Position` | `lastQuotedAt` | Check on session start, re-import if stale |
| Position P&L | **Computed** | N/A | Derived: (MarketBar.close - Position.avgPrice) × qty |
| Analyst consensus | `AnalystRecommendation` | `period` + `fetchedAt` | Monthly data, refresh daily |
| Earnings dates | `EarningsEvent` | `reportDate` + `fetchedAt` | Refresh weekly |
| Portfolio history | `PortfolioSnapshot` | `takenAt` | Snapshot per session/daily/weekly |
| Import tracking | `DataImportLog` | `fetchedAt` | Check before API calls |

No piece of data is stored in two places for the same purpose. The snapshot stores historical prices (audit trail), not live ones (derived from MarketBar).

## Related
- `computed-portfolio-endpoint.prompt.md` — must exist first (provides the live computed data)
- `import-portfolio-to-positions.prompt.md` — positions must be in DB
- `data-import-handler.prompt.md` — freshness checks for earnings/analyst data
