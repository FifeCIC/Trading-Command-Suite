---
description: "Import and persist the Alpha Vantage EARNINGS_CALENDAR to the database so earnings data is available offline, never hits rate limits again, and can be cross-referenced with portfolio holdings. Use when: first-time Alpha Vantage setup, refreshing earnings data, or after wiring the earnings adapter."
argument-hint: "Horizon months (3, 6, 12)?"
---
Import the Alpha Vantage EARNINGS_CALENDAR and persist it to the database.

> **Note**: This is the earnings-specific implementation. The general solution is the `data-import-handler` prompt — a unified handler that paginates, tracks freshness, and works across ALL data types. Run that prompt first for the full infrastructure.

## Problem
- Alpha Vantage free tier: 5 calls/min, 500/day
- Each symbol query costs 1 call — impossible to check all portfolio holdings
- The batch endpoint (no symbol) returns ALL upcoming earnings in one call
- But the data is discarded after the session — wasted API call

## Solution: Store Once, Query Many

### 1. Create Earnings Prisma Model
Add to `nest/prisma/schema.prisma`:

```prisma
model EarningsEvent {
  id               Int      @id @default(autoincrement())
  symbol           String
  name             String?
  reportDate       DateTime
  fiscalDateEnding DateTime?
  epsEstimate      Float?
  epsActual        Float?
  revenueEstimate  Float?
  revenueActual    Float?
  surprisePercent  Float?
  timeOfDay        String?  // 'Before Open' | 'After Close'
  currency         String   @default("USD")
  source           String   @default("alphavantage")
  fetchedAt        DateTime @default(now())
  createdAt        DateTime @default(now())

  @@index([symbol])
  @@index([reportDate])
  @@unique([symbol, reportDate])
}
```

### 2. Create Earnings Import Service
Create `nest/src/modules/earnings/earnings-import.service.ts`:

```typescript
@Injectable()
export class EarningsImportService {
  constructor(
    private readonly alphaVantage: AlphaVantageAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async importCalendar(horizonMonths = 3): Promise<{ imported: number; skipped: number }> {
    // 1. Fetch ALL upcoming earnings in ONE API call
    const events = await this.alphaVantage.getEarningsCalendar(undefined, horizonMonths);
    
    // 2. Bulk upsert to database
    let imported = 0, skipped = 0;
    for (const event of events) {
      try {
        await this.prisma.earningsEvent.upsert({
          where: { symbol_reportDate: { symbol: event.symbol, reportDate: new Date(event.reportDate) } },
          create: { ...event, reportDate: new Date(event.reportDate), fiscalDateEnding: event.fiscalDateEnding ? new Date(event.fiscalDateEnding) : null },
          update: { epsEstimate: event.epsEstimate, source: event.source, fetchedAt: new Date() },
        });
        imported++;
      } catch { skipped++; }
    }
    return { imported, skipped };
  }
}
```

### 3. Create Earnings Controller
```typescript
@Controller('earnings')
export class EarningsController {
  @Post('import')
  async import(@Query('horizon') horizon?: string) {
    const months = parseInt(horizon || '3', 10);
    return this.importService.importCalendar(months);
  }

  @Get('calendar')
  async getCalendar(@Query('days') days = 90) {
    // Read from DB — NO API call needed!
    return this.prisma.earningsEvent.findMany({
      where: { reportDate: { gte: new Date(), lte: this.addDays(days) } },
      orderBy: { reportDate: 'asc' },
    });
  }

  @Get('symbol/:symbol')
  async getForSymbol(@Param('symbol') symbol: string) {
    return this.prisma.earningsEvent.findFirst({
      where: { symbol: symbol.toUpperCase(), reportDate: { gte: new Date() } },
      orderBy: { reportDate: 'asc' },
    });
  }
}
```

### 4. Auto-Import on Startup
In `AppModule.onModuleInit()` or a scheduled cron:
- Check if earnings data is stale (>7 days)
- If stale, trigger import (respects 1 call = all data)
- Log: `Earnings refreshed: 8,432 events imported, 0 skipped`

### 5. Portfolio Cross-Reference (FREE — no API calls!)
```sql
SELECT p.ticker, e.reportDate, e.epsEstimate, e.name
FROM earnings_events e
JOIN symbols s ON s.ticker = e.symbol
WHERE e.reportDate BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 90 DAY)
  AND e.symbol IN ('NVDA','MSTR','RBLX','SOUN','METC','XIACY','AIR','RTP','ACIC','PTGEF')
ORDER BY e.reportDate ASC;
```

## Benefits
- **1 API call** replaces hundreds of individual symbol queries
- Portfolio cross-reference becomes a **free DB query**
- Earnings calendar page loads **instantly** from DB
- Never hits Alpha Vantage rate limits for earnings again
- Schedule weekly refresh to keep data current

## Related Files
- `nest/prisma/schema.prisma` — add EarningsEvent model
- `nest/src/modules/earnings/` — new module (create)
- `nest/src/modules/providers/adapters/alpha-vantage.adapter.ts` — already has getEarningsCalendar
