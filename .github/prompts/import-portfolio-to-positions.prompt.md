---
description: "Import live Trading212 portfolio positions into the normalized Position table with proper FK to Symbol, no redundant price data, and freshness tracking via lastQuotedAt. Use when: first-time portfolio import, syncing Trading212 positions to DB, or after the Position table schema is normalized."
argument-hint: "Force re-import or sync only?"
---
Import live Trading212 positions into the normalized `Position` table.

## What This Does
Bridges the gap between the Trading212 API (live portfolio) and the database (Position table). Once imported, positions persist across sessions and can be cross-referenced with earnings, analyst data, and scores without re-hitting the Trading212 API.

## The Import Flow

```
Trading212 API (live)
  → GET /equity/portfolio
  → GET /equity/account/cash
  → For each position:
      1. Find or create Symbol row (FK)
      2. UPSERT into Position table
         - symbolId → Symbol.id
         - quantity, avgPrice (cost basis ONLY)
         - provider = 'trading212'
         - lastQuotedAt = now() (marks as fresh)
      3. Do NOT store currentPrice or pnl (derived at query time)
  → Record import in ImportRun table
```

## Implementation

### 1. Create PositionImportService
`nest/src/modules/portfolio/position-import.service.ts`:

```typescript
@Injectable()
export class PositionImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly t212: Trading212Adapter,
  ) {}

  async importFromTrading212(): Promise<ImportResult> {
    // 1. Fetch live positions
    const rawPositions = await this.t212.getPositions();
    const account = await this.t212.getAccountCash();
    
    let created = 0, updated = 0;
    
    for (const pos of rawPositions) {
      // 2. Normalize ticker
      const cleanSymbol = this.normalizeTicker(pos.ticker);
      
      // 3. Find or create Symbol
      let symbol = await this.prisma.symbol.findUnique({ 
        where: { ticker: cleanSymbol } 
      });
      if (!symbol) {
        symbol = await this.prisma.symbol.create({
          data: { ticker: cleanSymbol, name: cleanSymbol, exchange: 'T212', type: 'stock' }
        });
      }
      
      // 4. UPSERT Position — only store cost basis, never currentPrice
      const existing = await this.prisma.position.findFirst({
        where: { symbol: cleanSymbol, provider: 'trading212' }
      });
      
      if (existing) {
        await this.prisma.position.update({
          where: { id: existing.id },
          data: { quantity: pos.quantity, avgPrice: pos.averagePrice, lastQuotedAt: new Date() }
        });
        updated++;
      } else {
        await this.prisma.position.create({
          data: {
            symbolId: symbol.id,
            symbol: cleanSymbol,
            quantity: pos.quantity,
            avgPrice: pos.averagePrice,
            provider: 'trading212',
            openedAt: pos.initialFillDate ? new Date(pos.initialFillDate) : new Date(),
            lastQuotedAt: new Date(),
          }
        });
        created++;
      }
    }
    
    return { created, updated, total: created + updated, accountValue: account?.total };
  }
}
```

### 2. Add Controller Endpoint
```typescript
@Post('portfolio/import-positions')
async importPositions() {
  return this.positionImportService.importFromTrading212();
}
```

### 3. Add to Portfolio Sync
Call this automatically after `POST /api/portfolio/trading212/import` completes.

## Querying Positions (No Redundancy)

```typescript
// GET /api/portfolio/positions — computed, not stored
async getPositionsWithLivePrice() {
  const positions = await this.prisma.position.findMany({
    include: { symbol: true }
  });
  
  return Promise.all(positions.map(async (p) => {
    const latestBar = await this.prisma.marketBar.findFirst({
      where: { symbolId: p.symbolId, timeframe: '1m' },
      orderBy: { timestamp: 'desc' },
    });
    
    const currentPrice = latestBar?.close ?? null;
    const value = currentPrice ? currentPrice * p.quantity : null;
    const pnl = currentPrice ? (currentPrice - p.avgPrice) * p.quantity : null;
    const pnlPct = pnl && p.avgPrice ? (pnl / (p.avgPrice * p.quantity)) * 100 : null;
    
    return {
      symbol: p.symbol,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      currentPrice,      // ← from MarketBar, NOT stored on Position
      value,             // ← computed
      pnl,               // ← computed
      pnlPct,            // ← computed
      provider: p.provider,
      lastQuotedAt: p.lastQuotedAt,
    };
  }));
}
```

## Benefits Over Current State
- Positions survive backend restarts (DB-backed, not API-only)
- No redundant `currentPrice` or `pnl` stored
- `lastQuotedAt` enables freshness tracking per position
- FK to Symbol enables JOIN queries (earnings, analyst data)
- ImportRun records track every sync

## Related
- `normalize-and-auto-refresh.prompt.md` — must run first (normalizes Position schema)
- `create-data-tables.prompt.md` — ensures Position table exists

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Trading212 portfolio import → Position table. Positions now DB-backed with FK to Symbol, survive server restarts.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `POST /api/portfolio/import-positions` — imports Trading212 positions into Position table
3. **DATABASE_SCHEMA** — Note Position table now stores: symbolId (FK), quantity, avgPrice, provider, lastQuotedAt (no currentPrice/pnl)
4. **SYSTEM_SPINE** — Add: `Trading212 API → PositionImportService → Position (DB) → ComputedPortfolioService`
5. **REVISION_LOG** — Add entry: `Portfolio positions imported to DB with normalized schema`
