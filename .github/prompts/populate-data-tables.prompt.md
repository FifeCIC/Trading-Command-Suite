---
description: "Create services to populate EarningsEvent and AnalystRecommendation tables from Alpha Vantage and Finnhub. Use when: the tables exist but are empty, after running create-data-tables migration, or when stale data needs a refresh."
argument-hint: "Which data to populate (earnings, analyst, all)?"
---
Populate the data storage tables with live API data — one-time fetch, persistent storage.

## Problem
The `EarningsEvent` and `AnalystRecommendation` tables exist (or will after `create-data-tables` migration) but are empty. Every trading session re-fetches this data from APIs, wasting rate limits and AI tokens.

## What This Builds

### 1. EarningsImportService
`nest/src/modules/earnings/earnings-import.service.ts`:

```typescript
@Injectable()
export class EarningsImportService {
  constructor(
    private readonly alphaVantage: AlphaVantageAdapter,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Fetch ALL upcoming earnings for 3 months in ONE API call.
   * Store to EarningsEvent table with upsert (don't duplicate).
   * Record the import in DataImportLog.
   */
  async importCalendar(horizonMonths = 3): Promise<{imported: number; skipped: number; logId: number}> {
    const startedAt = Date.now();
    
    // 1. Fetch all events (1 API call)
    const events = await this.alphaVantage.getEarningsCalendar(undefined, horizonMonths);
    
    // 2. Bulk upsert
    let imported = 0, skipped = 0;
    for (const event of events) {
      try {
        await this.prisma.earningsEvent.upsert({
          where: { 
            symbol_reportDate: { 
              symbol: event.symbol, 
              reportDate: new Date(event.reportDate) 
            } 
          },
          create: { ...event, reportDate: new Date(event.reportDate) },
          update: { epsEstimate: event.epsEstimate, fetchedAt: new Date() },
        });
        imported++;
      } catch { skipped++; }
    }
    
    // 3. Log the import
    const log = await this.prisma.dataImportLog.create({
      data: {
        dataType: 'earnings',
        source: 'alphavantage',
        status: 'success',
        recordsFetched: events.length,
        recordsStored: imported,
        recordsSkipped: skipped,
        durationMs: Date.now() - startedAt,
        dateRangeStart: new Date(),
        dateRangeEnd: this.addMonths(new Date(), horizonMonths),
      }
    });
    
    return { imported, skipped, logId: log.id };
  }

  /**
   * Check if earnings data is fresh (imported within 7 days).
   * Returns false if import needed.
   */
  async isFresh(): Promise<boolean> {
    const lastImport = await this.prisma.dataImportLog.findFirst({
      where: { dataType: 'earnings', status: 'success' },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!lastImport) return false;
    return (Date.now() - lastImport.fetchedAt.getTime()) < 7 * 24 * 3600_000;
  }
}
```

### 2. AnalystImportService
`nest/src/modules/analyst/analyst-import.service.ts`:

```typescript
@Injectable()
export class AnalystImportService {
  constructor(
    private readonly finnhub: FinnhubAdapter,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Fetch analyst recommendations for tracked symbols.
   * Uses portfolio positions + watchlist symbols.
   */
  async importForTrackedSymbols(): Promise<{imported: number; errors: number}> {
    // Get all tracked symbols
    const positions = await this.prisma.position.findMany({ select: { symbol: true } });
    const watchlistItems = await this.prisma.watchlistMeta.findMany({ select: { symbol: true } });
    const symbols = [...new Set([...positions, ...watchlistItems].map(s => s.symbol))];
    
    let imported = 0, errors = 0;
    
    for (const symbol of symbols) {
      try {
        const recs = await this.finnhub.getRecommendations(symbol);
        if (!recs) { errors++; continue; }
        
        for (const rec of recs) {
          await this.prisma.analystRecommendation.upsert({
            where: {
              symbol_period_source: {
                symbol: rec.symbol,
                period: rec.period,
                source: 'finnhub',
              }
            },
            create: { ...rec, source: 'finnhub' },
            update: {
              strongBuy: rec.strongBuy,
              buy: rec.buy,
              hold: rec.hold,
              sell: rec.sell,
              strongSell: rec.strongSell,
              fetchedAt: new Date(),
            },
          });
          imported++;
        }
      } catch { errors++; }
    }
    
    // Log
    await this.prisma.dataImportLog.create({
      data: {
        dataType: 'analyst_recommendations',
        source: 'finnhub',
        status: errors === 0 ? 'success' : 'partial',
        recordsFetched: imported + errors,
        recordsStored: imported,
        recordsSkipped: errors,
      }
    });
    
    return { imported, errors };
  }
}
```

### 3. API Endpoints

```typescript
@Controller('data-import')
export class DataImportController {
  
  @Post('import/earnings')
  async importEarnings(@Query('horizon') horizon?: string) {
    const months = parseInt(horizon || '3', 10);
    return this.earningsImport.importCalendar(months);
  }
  
  @Post('import/analyst')
  async importAnalyst() {
    return this.analystImport.importForTrackedSymbols();
  }
  
  @Post('import/all')
  async importAll() {
    const [earnings, analyst] = await Promise.all([
      this.earningsImport.importCalendar(),
      this.analystImport.importForTrackedSymbols(),
    ]);
    return { earnings, analyst };
  }
  
  @Get('status')
  async getStatus() {
    return {
      earnings: { fresh: await this.earningsImport.isFresh() },
      analyst: { fresh: await this.analystImport.isFresh() },
    };
  }
}
```

## Usage

```bash
# First-time setup — populate everything
curl -X POST "http://localhost:3201/api/data-import/import/all"

# Check if data is fresh
curl "http://localhost:3201/api/data-import/status"

# Refresh earnings only (once per week)
curl -X POST "http://localhost:3201/api/data-import/import/earnings?horizon=3"

# Refresh analyst recs (once per day, 1 call per symbol)
curl -X POST "http://localhost:3201/api/data-import/import/analyst"
```

## After Import — Query DB, Not APIs

```sql
-- What earnings are coming up for my portfolio?
SELECT e.symbol, e.reportDate, e.epsEstimate, p.quantity
FROM EarningsEvent e
JOIN \`Position\` p ON p.symbol = e.symbol
WHERE e.reportDate BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 90 DAY)
ORDER BY e.reportDate;

-- What's the analyst consensus for my holdings?
SELECT a.symbol, a.strongBuy, a.buy, a.hold, a.sell, a.strongSell
FROM AnalystRecommendation a
JOIN \`Position\` p ON p.symbol = a.symbol
WHERE a.period = (SELECT MAX(period) FROM AnalystRecommendation WHERE symbol = a.symbol);
```

## Related
- `create-data-tables.prompt.md` — tables must exist first
- `import-portfolio-to-positions.prompt.md` — positions must be in DB for symbol discovery
- `store-earnings-calendar.prompt.md` — original earnings-only version (this supersedes it)

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: EarningsImportService and AnalystImportService created. EarningsEvent + AnalystRecommendation tables populated from Alpha Vantage + Finnhub. DataImportLog tracks all imports.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `POST /api/data-import/import/earnings`, `POST /api/data-import/import/analyst`, `POST /api/data-import/import/all`, `GET /api/data-import/status`
3. **DATABASE_SCHEMA** — Add EarningsEvent, AnalystRecommendation, DataImportLog models
4. **SYSTEM_SPINE** — Add: `Alpha Vantage EARNINGS_CALENDAR → EarningsImportService → EarningsEvent (DB) → earnings-proximity directive`
5. **REVISION_LOG** — Add entry: `Data population services — earnings + analyst data stored persistently`
