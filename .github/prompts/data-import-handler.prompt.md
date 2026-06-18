---
description: "Design and implement a unified DataImportHandler that tracks freshness across ALL data types (earnings, dividends, economic events, market bars, profiles), paginates large datasets, respects rate limits, and stores results persistently so agents and the app never re-fetch the same data. Use when: building the central data import orchestration layer, adding a new data type to track, or after hitting rate limits from repeated API calls."
argument-hint: "Which data types to include?"
---
Design a unified DataImportHandler — the central nervous system for data freshness across the entire Trading Command Suite.

## The Vision
A single handler that knows:
- **What** data types exist (earnings, dividends, economic events, market bars, news, profiles)
- **When** each was last imported (from a persistent log)
- **How** to fetch incrementally (paginated, since last successful import)
- **Where** to store results (type-specific DB tables or cache)
- **Which** provider to use (rate-limit-aware adapter selection via AdapterFactory)

This eliminates the "Big Miss" — the 10,000-row earnings batch that was fetched but discarded.

---

## Architecture

### 1. DataImportLog — The Source of Truth

Add to `nest/prisma/schema.prisma`:

```prisma
model DataImportLog {
  id            Int      @id @default(autoincrement())
  dataType      String   // 'earnings', 'dividends', 'economic_events', 'market_bars', 'news', 'profiles'
  source        String   // 'alphavantage', 'finnhub', 'fmp', 'trading212', 'mt5'
  status        String   // 'success', 'partial', 'failed', 'rate_limited'
  dateRangeStart DateTime? // Start of data window fetched
  dateRangeEnd   DateTime? // End of data window fetched
  recordsFetched Int      @default(0)
  recordsStored  Int      @default(0)
  recordsSkipped Int      @default(0)
  errorMessage   String?
  rateLimitHits  Int      @default(0)
  durationMs     Int?     // How long the import took
  fetchedAt      DateTime @default(now())
  
  @@index([dataType])
  @@index([dataType, status, fetchedAt])
}
```

### 2. DataImportHandler Service

Create `nest/src/modules/data-import/data-import-handler.service.ts`:

```typescript
@Injectable()
export class DataImportHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Smart import: only fetches what's stale.
   * 
   * @param dataType  'earnings' | 'dividends' | 'economic_events' | etc.
   * @param options   Force re-import, date range override, pagination config
   */
  async importIfStale(dataType: string, options?: ImportOptions): Promise<ImportResult> {
    // 1. Check last successful import
    const lastImport = await this.prisma.dataImportLog.findFirst({
      where: { dataType, status: 'success' },
      orderBy: { fetchedAt: 'desc' },
    });

    // 2. Determine staleness
    const staleness = this.getStalenessConfig(dataType);
    const isStale = !lastImport || 
      (Date.now() - lastImport.fetchedAt.getTime()) > staleness.maxAgeMs;

    if (!isStale && !options?.force) {
      return { status: 'fresh', lastImport };
    }

    // 3. Determine date range
    const dateFrom = options?.dateFrom ?? 
      (lastImport?.dateRangeEnd ?? new Date());
    const dateTo = options?.dateTo ?? 
      this.addDays(new Date(), staleness.defaultLookaheadDays);

    // 4. Fetch with pagination
    return this.fetchPaginated(dataType, dateFrom, dateTo, options);
  }

  /**
   * Paginated fetch — splits large date ranges into chunks to avoid
   * overwhelming APIs and to enable resume-after-failure.
   */
  private async fetchPaginated(
    dataType: string, 
    dateFrom: Date, 
    dateTo: Date,
    options?: ImportOptions,
  ): Promise<ImportResult> {
    const chunkDays = options?.chunkDays ?? 30; // Default: 30-day chunks
    let currentFrom = new Date(dateFrom);
    let totalFetched = 0, totalStored = 0, totalSkipped = 0;

    while (currentFrom < dateTo) {
      const chunkTo = this.addDays(currentFrom, chunkDays);
      if (chunkTo > dateTo) chunkTo.setTime(dateTo.getTime());

      const chunkResult = await this.fetchChunk(dataType, currentFrom, chunkTo);
      
      totalFetched += chunkResult.fetched;
      totalStored += chunkResult.stored;
      totalSkipped += chunkResult.skipped;

      // Log each chunk for resume capability
      await this.logImport(dataType, 'alphavantage', 
        chunkResult.success ? 'success' : 'partial',
        currentFrom, chunkTo, 
        chunkResult.fetched, chunkResult.stored, chunkResult.skipped);

      if (!chunkResult.success) break; // Stop on failure — resume next time
      
      currentFrom = chunkTo;
    }

    return { 
      status: totalFetched > 0 ? 'success' : 'empty',
      totalFetched, totalStored, totalSkipped 
    };
  }

  /**
   * Route to the correct fetcher based on data type.
   */
  private async fetchChunk(dataType: string, from: Date, to: Date) {
    switch (dataType) {
      case 'earnings':
        return this.fetchEarningsChunk(from, to);
      case 'dividends':
        return this.fetchDividendsChunk(from, to);
      // ... more types
      default:
        throw new Error(`Unknown data type: ${dataType}`);
    }
  }

  private getStalenessConfig(dataType: string): StalenessConfig {
    const configs: Record<string, StalenessConfig> = {
      earnings:    { maxAgeMs: 7 * 24 * 3600_000, defaultLookaheadDays: 90, chunkDays: 30 },
      dividends:   { maxAgeMs: 7 * 24 * 3600_000, defaultLookaheadDays: 90, chunkDays: 30 },
      market_bars: { maxAgeMs: 1 * 3600_000,       defaultLookaheadDays: 1,  chunkDays: 1 },
      profiles:    { maxAgeMs: 30 * 24 * 3600_000,  defaultLookaheadDays: 365, chunkDays: 365 },
      news:        { maxAgeMs: 6 * 3600_000,        defaultLookaheadDays: 1,  chunkDays: 1 },
    };
    return configs[dataType] ?? configs.earnings;
  }
}
```

### 3. Integration with Existing Systems

**CacheService**: Import results are cached with type-specific TTLs
```typescript
// After import:
this.cache.set(`import:earnings:last`, result, 7 * 24 * 3600_000);
```

**FreshnessService**: Extend to cover non-bar data types
```typescript
// Add to FreshnessService:
async checkDataTypeFreshness(dataType: string): Promise<FreshnessResult> {
  const lastImport = await this.prisma.dataImportLog.findFirst({
    where: { dataType, status: 'success' },
    orderBy: { fetchedAt: 'desc' },
  });
  // ...
}
```

**AdapterFactory**: Already rate-limit-aware — the import handler uses `adapterFactory.getActive()` to pick the best provider.

### 4. REST API

```typescript
@Controller('data-import')
export class DataImportController {
  
  @Get('status/:dataType')
  async getStatus(@Param('dataType') dataType: string) {
    // Returns last import info + staleness
  }

  @Post('import/:dataType')
  async triggerImport(
    @Param('dataType') dataType: string,
    @Query('force') force?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.handler.importIfStale(dataType, {
      force: force === 'true',
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });
  }

  @Get('log/:dataType')
  async getImportHistory(@Param('dataType') dataType: string) {
    return this.prisma.dataImportLog.findMany({
      where: { dataType },
      orderBy: { fetchedAt: 'desc' },
      take: 20,
    });
  }
}
```

### 5. Usage Examples

**Earnings — one call for 3 months, paginated by 30-day chunks:**
```bash
curl -X POST "http://localhost:3201/api/data-import/import/earnings?force=true"
# Fetches 30-day chunks, stores ~10,000 events to DB
# Next call: skips — data is fresh for 7 days
```

**Market bars — hourly auto-refresh:**
```bash
curl -X POST "http://localhost:3201/api/data-import/import/market_bars"
# Only fetches symbols stale >1 hour
# Respects rate limits across all providers
```

**Check what's fresh:**
```bash
curl "http://localhost:3201/api/data-import/status/earnings"
# { "dataType": "earnings", "status": "fresh", "lastImported": "2026-06-17", "recordsStored": 10432 }
```

---

## What This Enables

| Before | After |
|--------|-------|
| Agent fetches earnings → hits rate limit → waits → retries | Agent queries DB → instant, no API call |
| 10,000-row batch discarded after session | Persisted to DB, queried forever |
| No way to know if data is stale | `GET /api/data-import/status/earnings` |
| Failed import = lost progress | Resumes from last successful chunk |
| Each data type has custom import logic | One handler, one pattern, one log table |

## Related Files
- `nest/prisma/schema.prisma` — add DataImportLog model
- `nest/src/modules/data-import/` — new module (create)
- `nest/src/modules/market-data/freshness.service.ts` — extend for non-bar types
- `nest/src/common/cache/cache.service.ts` — already exists, use for import result caching
- `nest/src/modules/providers/adapter-factory.ts` — already rate-limit-aware, use for provider selection
- `nest/src/modules/providers/adapters/alpha-vantage.adapter.ts` — already has getEarningsCalendar

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: DataImportHandler — unified import orchestration across all data types with pagination, staleness config, and DataImportLog tracking.`
2. **CURRENT_ROUTE_CONTRACTS** — Add: `POST /api/data-import/import/:dataType`, `GET /api/data-import/status/:dataType`, `GET /api/data-import/log/:dataType`
3. **DATABASE_SCHEMA** — Add DataImportLog model to plannedMetaTables
4. **SYSTEM_SPINE** — Add: `DataImportHandler.importIfStale() → FetchPaginated() → Provider Adapter → Type-Specific DB Table → DataImportLog`
5. **REVISION_LOG** — Add entry: `DataImportHandler — paginated, staleness-aware data import for all types`
