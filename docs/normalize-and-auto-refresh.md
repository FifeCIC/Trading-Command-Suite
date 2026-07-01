---
description: "Fix schema redundancy, extend the freshness system to cover ALL data types, build a PriceRefreshService with provider fallback that decides when to commit to DB, and create a React hook for page-open-triggered data refresh. Use when: normalizing the data model, building the price refresh pipeline, or implementing automatic data freshness."
argument-hint: "Which data types to cover (prices, earnings, analyst, all)?"
---
Fix schema normalization, extend freshness tracking, and build the automatic data refresh pipeline with provider fallback and write-threshold decisions.

## Problem Summary

| Issue | Current State |
|-------|--------------|
| `Position.currentPrice` stored redundantly | Should come from MarketBar or live quote |
| `Position.pnl` stored redundantly | Should be computed: (price - avgPrice) × qty |
| No FK from Position→Symbol | Flat string reference, no referential integrity |
| FreshnessService only covers MarketBar | No coverage for positions, earnings, analyst data |
| No page-open trigger for refresh | Users see stale data until manual refresh |
| No write-threshold decision engine | "Should I commit this price to DB or just return it?" |
| Provider fallback exists but unused for positions | AdapterFactory ready, no caller |


## 1. Normalize the Schema

### Position — Remove Redundancy
```prisma
model Position {
  id           String    @id @default(uuid()) @db.VarChar(36)
  symbolId     String    @db.VarChar(36)
  quantity     Float
  avgPrice     Float     // Cost basis — the ONE price we store
  provider     String    @db.VarChar(50)
  accountId    String?   @db.VarChar(100)
  openedAt     DateTime  @default(now())
  lastQuotedAt DateTime? // When was price last checked (not the price itself)
  updatedAt    DateTime  @updatedAt

  symbol       Symbol    @relation(fields: [symbolId], references: [id])

  @@index([symbolId])
  @@index([provider, accountId])
}
```

**Remove**: `currentPrice`, `pnl`  
**Add**: FK `symbolId` → `Symbol`, `lastQuotedAt`  
**Query-time compute**: currentPrice from MarketBar, pnl = (currentPrice - avgPrice) * quantity

### Trade — Link to Position
```prisma
model Trade {
  id          String    @id @default(uuid()) @db.VarChar(36)
  positionId  String?   @db.VarChar(36)  // NEW: link to parent position
  symbolId    String    @db.VarChar(36)  // NEW: FK
  side        String    @db.VarChar(10)
  quantity    Float
  entryPrice  Float
  exitPrice   Float?
  status      String    @default("open") @db.VarChar(50)
  provider    String    @db.VarChar(50)
  strategy    String?   @db.VarChar(200)
  openedAt    DateTime  @default(now())
  closedAt    DateTime?

  symbol      Symbol    @relation(fields: [symbolId], references: [id])
  position    Position? @relation(fields: [positionId], references: [id])

  @@index([symbolId, openedAt])
  @@index([status])
}
```

**Remove**: `pnl` (compute: (exitPrice - entryPrice) * quantity for closed trades)  
**Add**: FK `symbolId` → `Symbol`, optional FK `positionId` → `Position`


## 2. Extend FreshnessService

### Per-DataType Staleness Config
```typescript
const STALENESS_CONFIG: Record<string, { maxAgeMs: number; description: string }> = {
  'market_bar_1m':  { maxAgeMs: 60_000,       description: '1-minute bars — intraday trading' },
  'market_bar_1h':  { maxAgeMs: 3_600_000,     description: '1-hour bars — swing trading' },
  'market_bar_1d':  { maxAgeMs: 86_400_000,    description: 'Daily bars — EOD analysis' },
  'position_price': { maxAgeMs: 60_000,         description: 'Position current price — 60s max' },
  'earnings':       { maxAgeMs: 604_800_000,    description: 'Earnings data — 7 days' },
  'analyst':        { maxAgeMs: 86_400_000,     description: 'Analyst recs — 24 hours' },
};
```

### New Methods
```typescript
// Check if positions need price refresh
async checkPositionFreshness(): Promise<Array<{symbol: string; status: FreshnessStatus; ageMs: number}>> {
  const positions = await this.prisma.position.findMany({
    select: { symbol: true, lastQuotedAt: true },
  });
  
  return positions.map((p) => {
    const ageMs = p.lastQuotedAt ? Date.now() - p.lastQuotedAt.getTime() : Infinity;
    const status: FreshnessStatus = ageMs > STALENESS_CONFIG.position_price.maxAgeMs 
      ? 'stale' : 'fresh';
    return { symbol: p.symbol, status, ageMs };
  });
}
```


## 3. Create PriceRefreshService — The Decision Engine

`nest/src/modules/market-data/price-refresh.service.ts`:

```typescript
@Injectable()
export class PriceRefreshService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Get the current price for a symbol with smart provider fallback.
   * Decides whether to use cache, fetch from provider, or read from DB.
   * 
   * Decision tree:
   *   1. Cache hit (<60s old)? → return immediately
   *   2. MarketBar recent (<60s)? → return from DB
   *   3. Need fresh quote → try providers in fallback order
   *   4. If MT5 is up: use MT5 (per-second), commit every 60s to DB
   *   5. Else: use best available, commit to MarketBar, update Position.lastQuotedAt
   */
  async getCurrentPrice(symbol: string, commitToDb = true): Promise<{price: number; source: string; fresh: boolean}> {
    // 1. Check cache
    const cacheKey = `price:${symbol}`;
    const cached = this.cache.get<{price: number; ts: number}>(cacheKey);
    if (cached && Date.now() - cached.ts < 60_000) {
      return { price: cached.price, source: 'cache', fresh: true };
    }

    // 2. Check MarketBar (DB)
    const latestBar = await this.prisma.marketBar.findFirst({
      where: { symbolId: symbol, timeframe: '1m' },
      orderBy: { timestamp: 'desc' },
    });
    if (latestBar && Date.now() - latestBar.timestamp.getTime() < 60_000) {
      this.cache.set(cacheKey, { price: latestBar.close, ts: Date.now() }, 60_000);
      return { price: latestBar.close, source: 'marketbar', fresh: true };
    }

    // 3. Provider fallback — MT5 first, then others
    const providerOrder = ['mt5', 'alpaca', 'trading212', 'finnhub', 'alphavantage', 'yahoo'];
    
    for (const providerId of providerOrder) {
      const adapter = this.adapterFactory.create(providerId);
      if (!adapter) continue;
      
      const quote = await adapter.getQuote(symbol);
      if (quote?.last) {
        const price = quote.last;
        
        // Cache in memory (always)
        this.cache.set(cacheKey, { price, ts: Date.now() }, 60_000);
        
        // Commit to DB (per write-threshold)
        if (commitToDb && this.shouldCommitToDb(symbol, providerId)) {
          await this.commitPrice(symbol, price, providerId);
        }
        
        return { price, source: providerId, fresh: true };
      }
    }

    // 4. Last resort: return stale MarketBar data
    if (latestBar) {
      return { price: latestBar.close, source: 'marketbar_stale', fresh: false };
    }
    
    throw new Error(`No price available for ${symbol}`);
  }

  /**
   * Write-threshold decision: should we commit this price to DB?
   * 
   * Rules:
   *   - MT5 (per-second source): commit every 60 seconds (don't flood DB)
   *   - Alpha Vantage (5/min): commit every fetch (already rate-limited)
   *   - Finnhub (60/min): commit every 60 seconds
   *   - Yahoo/Fallback: commit every 5 minutes
   */
  private shouldCommitToDb(symbol: string, providerId: string): boolean {
    const thresholds: Record<string, number> = {
      mt5: 60_000,          // 60 seconds
      alpaca: 60_000,
      trading212: 60_000,
      finnhub: 60_000,
      alphavantage: 0,      // Always commit (API is the rate limiter)
      yahoo: 300_000,       // 5 minutes
    };
    
    const threshold = thresholds[providerId] ?? 60_000;
    const lastCommitKey = `last_commit:price:${symbol}`;
    const lastCommit = this.cache.get<number>(lastCommitKey);
    
    if (!lastCommit || Date.now() - lastCommit > threshold) {
      this.cache.set(lastCommitKey, Date.now(), threshold);
      return true;
    }
    return false;
  }

  private async commitPrice(symbol: string, price: number, source: string): Promise<void> {
    // Store in MarketBar
    await this.prisma.marketBar.create({
      data: {
        symbolId: symbol,
        provider: source,
        timeframe: '1m',
        timestamp: new Date(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
      },
    });

    // Update Position.lastQuotedAt (NOT currentPrice)
    await this.prisma.position.updateMany({
      where: { symbol },
      data: { lastQuotedAt: new Date() },
    });
  }
}
```


## 4. React Hook — Page-Open Trigger

`src/hooks/useDataFreshness.js`:

```javascript
import { useEffect, useState } from 'react';
import { apiGet } from '../core/api/client';

/**
 * Triggers a freshness check when a component mounts.
 * If data is stale AND this page hasn't been viewed today, refresh.
 */
export function useDataFreshness(pageId, dataType, options = {}) {
  const [status, setStatus] = useState('checking');
  const { maxStaleMs = 3600_000, autoRefresh = true } = options;

  useEffect(() => {
    const storageKey = `tcs:freshness:${pageId}:${dataType}`;
    const lastCheck = localStorage.getItem(storageKey);
    const today = new Date().toDateString();

    // Already checked today? Skip (unless forced)
    if (lastCheck === today && !options.force) {
      setStatus('fresh_today');
      return;
    }

    async function check() {
      try {
        const res = await apiGet(`/api/market-data/freshness?dataType=${dataType}`);
        const isStale = res.results?.some((r) => r.status !== 'fresh');
        
        if (isStale && autoRefresh) {
          setStatus('refreshing');
          await apiGet(`/api/market-data/refresh?dataType=${dataType}`);
          setStatus('refreshed');
        } else {
          setStatus('fresh');
        }
        
        localStorage.setItem(storageKey, today);
      } catch {
        setStatus('error');
      }
    }

    check();
  }, [pageId, dataType]);

  return status;
}
```

Usage in any page:
```jsx
export default function AccountsDashboardPage() {
  const priceStatus = useDataFreshness('accounts-dashboard', 'position_price');
  // priceStatus: 'checking' → 'refreshing' → 'refreshed' → show spinner then data
}
```


## 5. API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/market-data/freshness?dataType=position_price` | Check staleness per data type |
| `GET /api/market-data/refresh?dataType=position_price` | Trigger refresh for stale data |
| `GET /api/market-data/price/:symbol` | Get current price with fallback chain |
| `GET /api/portfolio/positions/computed` | Positions with computed pnl + current price (no redundancy) |

## Migration

After schema changes:
```bash
npx prisma migrate dev --name normalize_positions_trades
```

Backfill `lastQuotedAt` for existing positions to `now()` so they start fresh.

## Related Files
- `nest/prisma/schema.prisma` — normalize Position, Trade models
- `nest/src/modules/market-data/freshness.service.ts` — extend for all data types
- `nest/src/modules/market-data/price-refresh.service.ts` — NEW: decision engine
- `nest/src/modules/market-data/market-data.controller.ts` — add refresh endpoints
- `src/hooks/useDataFreshness.js` — NEW: page-open trigger hook
- `nest/src/modules/portfolio/portfolio.service.ts` — add computed position endpoint

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Position/Trade schema normalized — FK to Symbol added, currentPrice/pnl removed (now derived via PriceRefreshService). FreshnessService extended to position_price/earnings/analyst data types. useDataFreshness React hook added.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `GET /api/market-data/price/:symbol`, `GET /api/market-data/freshness?dataType=`, `GET /api/market-data/refresh?dataType=`
3. **DATABASE_SCHEMA** — Update Position model: remove currentPrice/pnl, add symbolId FK and lastQuotedAt. Update Trade: remove pnl, add positionId FK and symbolId FK.
4. **SYSTEM_SPINE** — Add: `PriceRefreshService → Provider Fallback Chain (MT5→Alpaca→T212→Finnhub→AV→Yahoo) → MarketBar (commit per threshold) → Position.lastQuotedAt`
5. **REVISION_LOG** — Add entry: `Schema normalized + PriceRefreshService with fallback + page-open refresh hook`
6. **KNOWN_GAPS** — Provider fallback chain needs MT5 to be online for per-second prices
