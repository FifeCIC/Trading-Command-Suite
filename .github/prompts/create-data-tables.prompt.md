---
description: "Add ALL missing database tables (EarningsEvent, AnalystRecommendation, DataImportLog, PriceTarget) to the Prisma schema and run the migration. Use when: setting up data persistence for earnings, analyst data, price targets, and unified import tracking. This consolidates the schema changes from earnings, forecast, and data-import prompts into one migration."
argument-hint: "Run `npx prisma migrate dev --name add_data_import_tables`"
---
Add all missing database tables required by the trading data pipeline.

## Tables to Add

Add these to `nest/prisma/schema.prisma` (append after existing models):

```prisma
// ─── Earnings Data ────────────────────────────────────────
model EarningsEvent {
  id               Int      @id @default(autoincrement())
  symbol           String   @db.VarChar(20)
  name             String?  @db.VarChar(200)
  reportDate       DateTime
  fiscalDateEnding DateTime?
  epsEstimate      Float?
  epsActual        Float?
  revenueEstimate  Float?
  revenueActual    Float?
  surprisePercent  Float?
  timeOfDay        String?  @db.VarChar(20)
  currency         String   @default("USD") @db.VarChar(10)
  source           String   @default("alphavantage") @db.VarChar(50)
  fetchedAt        DateTime @default(now())

  @@unique([symbol, reportDate])
  @@index([symbol])
  @@index([reportDate])
}

// ─── Analyst Recommendations ──────────────────────────────
model AnalystRecommendation {
  id         Int      @id @default(autoincrement())
  symbol     String   @db.VarChar(20)
  period     String   @db.VarChar(10)
  strongBuy  Int      @default(0)
  buy        Int      @default(0)
  hold       Int      @default(0)
  sell       Int      @default(0)
  strongSell Int      @default(0)
  source     String   @default("finnhub") @db.VarChar(50)
  fetchedAt  DateTime @default(now())

  @@unique([symbol, period, source])
  @@index([symbol])
  @@index([period])
}

// ─── Price Targets (FMP) ─────────────────────────────────
model PriceTarget {
  id                Int      @id @default(autoincrement())
  symbol            String   @db.VarChar(20)
  source            String   @default("fmp") @db.VarChar(50)
  targetHigh        Float?
  targetLow         Float?
  targetConsensus   Float?
  targetMedian      Float?
  numberOfAnalysts  Int?
  lastUpdated       DateTime @default(now())
  fetchedAt         DateTime @default(now())

  @@unique([symbol, source])
  @@index([symbol])
}

// ─── Unified Import Tracking ──────────────────────────────
model DataImportLog {
  id             Int      @id @default(autoincrement())
  dataType       String   @db.VarChar(50)
  source         String   @db.VarChar(50)
  status         String   @db.VarChar(20)
  dateRangeStart DateTime?
  dateRangeEnd   DateTime?
  recordsFetched Int      @default(0)
  recordsStored  Int      @default(0)
  recordsSkipped Int      @default(0)
  errorMessage   String?  @db.Text
  rateLimitHits  Int      @default(0)
  durationMs     Int?
  fetchedAt      DateTime @default(now())

  @@index([dataType])
  @@index([dataType, status, fetchedAt])
}
```

## Migration Commands

```bash
cd C:\wamp64\www\trading-command-suite\nest
npx prisma migrate dev --name add_data_import_tables
```

Then regenerate the Prisma client:
```bash
npx prisma generate
```

## After Migration — Initial Data Import

Once tables exist, run these to populate them:

```bash
# Import all upcoming earnings (1 API call = all data for 3 months)
curl -X POST "http://localhost:3201/api/data-import/import/earnings?force=true"

# Import analyst recommendations for portfolio symbols
curl -X POST "http://localhost:3201/api/data-import/import/recommendations"

# Import price targets for portfolio symbols
curl -X POST "http://localhost:3201/api/data-import/import/price-targets"
```

## What Each Table Feeds

| Table | Filled By | Consumed By |
|-------|-----------|-------------|
| EarningsEvent | Alpha Vantage EARNINGS_CALENDAR | earnings-proximity directive, EarningsCalendarPage, portfolio events cross-reference |
| AnalystRecommendation | Finnhub /stock/recommendation | analyst-adjustments directive, PriceForecastPage |
| PriceTarget | FMP /price-target | ForecastMergeService, analyst-adjustments directive (deviation scoring) |
| DataImportLog | All import operations | DataImportHandler (staleness checks), admin dashboard |

## Verification

```sql
-- Check earnings imported
SELECT COUNT(*) FROM EarningsEvent;
SELECT symbol, reportDate, epsEstimate FROM EarningsEvent 
  WHERE symbol IN ('NVDA','MSTR') ORDER BY reportDate;

-- Check analyst data imported
SELECT symbol, period, strongBuy, buy, hold, sell, strongSell 
  FROM AnalystRecommendation WHERE symbol IN ('NVDA','MSTR') ORDER BY period DESC;

-- Check price targets
SELECT * FROM PriceTarget WHERE symbol = 'NVDA';

-- Check import history
SELECT dataType, status, recordsFetched, fetchedAt 
  FROM DataImportLog ORDER BY fetchedAt DESC LIMIT 10;
```

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: Data storage tables created — EarningsEvent, AnalystRecommendation, PriceTarget, DataImportLog.`
2. **DATABASE_SCHEMA** — Add all four models to coreEntities/marketDataEntities with their indexes and unique constraints
3. **REVISION_LOG** — Add entry: `Data storage schema — EarningsEvent, AnalystRecommendation, PriceTarget, DataImportLog tables`
