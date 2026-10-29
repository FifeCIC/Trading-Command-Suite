-- schema-init.sql — the FULL application schema, GENERATED from prisma/schema.prisma.
-- =====================================================================================================
-- ⚠️ THIS FILE IS GENERATED. DO NOT EDIT IT BY HAND — a hand-edited copy drifts from the model, which
-- is the defect it exists to remove. Regenerate with:
--
--     npm --prefix nest run db:init:gen        (writes)
--     npm --prefix nest run db:init:gen:check  (fails if stale)
--
-- ⚠️ WHY A GENERATOR AND NOT A DOCUMENTED COMMAND (#997). The raw `prisma migrate diff` output is not
-- directly shippable: `@default(now())` emits `DEFAULT CURRENT_TIMESTAMP(3)`, which MySQL evaluates
-- in the SESSION timezone (SYSTEM = local). This app stores UTC, so a fresh install would write
-- timestamps in the future with no error — the #844 fault. The generator applies that correction
-- (113 default(s) rewritten to `UTC_TIMESTAMP`) and is reproducible.
--
-- ⚠️ The prebuild gate caught this, and it is worth recording: validate-local-time-sources.cjs failed
-- the build on the FIRST generated version and named every offending column.
--
-- SCALE: 121 CREATE TABLE statements.
--
-- WHAT IT DOES NOT COVER, and both are intentional:
--   1. The 13 raw-managed tables (4 with checked-in DDL in prisma/raw-managed/, 9 created by
--      bootstrapSchema() at boot). They are deliberately NOT in schema.prisma, which is why
--      `db push` is banned here (#769).
--   2. Seed DATA. A schema is not a seed; run the seeders after this.
--
-- USAGE (fresh database only):  npm --prefix nest run db:init
-- =====================================================================================================

-- CreateTable
CREATE TABLE `Symbol` (
    `id` VARCHAR(36) NOT NULL,
    `ticker` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `exchange` VARCHAR(50) NULL,
    `type` VARCHAR(50) NOT NULL,
    `tags` JSON NOT NULL,
    `aliases` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Symbol_ticker_key`(`ticker`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Strategy` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    `config` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Directive` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `weight` DOUBLE NOT NULL,
    `config` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `nature` VARCHAR(30) NULL,
    `readiness` VARCHAR(10) NOT NULL DEFAULT 'alpha',
    `parentId` VARCHAR(36) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT true,
    `forkReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Directive_strategyId_idx`(`strategyId`),
    INDEX `Directive_parentId_idx`(`parentId`),
    INDEX `Directive_isDefault_idx`(`isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Score` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `value` DOUBLE NOT NULL,
    `breakdown` JSON NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `Score_symbolId_timestamp_idx`(`symbolId`, `timestamp`),
    INDEX `Score_strategyId_timestamp_idx`(`strategyId`, `timestamp`),
    INDEX `Score_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Signal` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `strength` DOUBLE NOT NULL,
    `price` DOUBLE NOT NULL,
    `reason` JSON NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `Signal_symbolId_createdAt_idx`(`symbolId`, `createdAt`),
    INDEX `Signal_strategyId_createdAt_idx`(`strategyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketBar` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `open` DOUBLE NOT NULL,
    `high` DOUBLE NOT NULL,
    `low` DOUBLE NOT NULL,
    `close` DOUBLE NOT NULL,
    `volume` DOUBLE NOT NULL,
    `recordingSessionId` VARCHAR(36) NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `MarketBar_symbolId_timeframe_timestamp_idx`(`symbolId`, `timeframe`, `timestamp`),
    INDEX `MarketBar_provider_importedAt_idx`(`provider`, `importedAt`),
    INDEX `MarketBar_recordingSessionId_idx`(`recordingSessionId`),
    INDEX `MarketBar_timestamp_idx`(`timestamp`),
    UNIQUE INDEX `MarketBar_symbolId_timeframe_timestamp_key`(`symbolId`, `timeframe`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportRun` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `source` VARCHAR(100) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `error` TEXT NULL,

    INDEX `ImportRun_symbolId_requestedAt_idx`(`symbolId`, `requestedAt`),
    INDEX `ImportRun_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TickRecordingSession` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL DEFAULT '5s',
    `status` VARCHAR(20) NOT NULL DEFAULT 'recording',
    `startedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `endedAt` DATETIME(3) NULL,
    `barCount` INTEGER NOT NULL DEFAULT 0,
    `gapCount` INTEGER NOT NULL DEFAULT 0,
    `lastBarAt` DATETIME(3) NULL,

    INDEX `TickRecordingSession_symbolId_startedAt_idx`(`symbolId`, `startedAt`),
    INDEX `TickRecordingSession_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BacktestRun` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `protocolId` VARCHAR(100) NOT NULL,
    `timeframe` VARCHAR(10) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `totalDays` INTEGER NOT NULL,
    `totalTrades` INTEGER NOT NULL,
    `totalSignals` INTEGER NULL,
    `botId` VARCHAR(36) NULL,
    `botBaseSize` DOUBLE NULL,
    `periodId` VARCHAR(36) NULL,
    `experimentId` VARCHAR(36) NULL,
    `iteration` INTEGER NULL,
    `configVersion` INTEGER NULL,
    `newsExclusion` VARCHAR(16) NOT NULL DEFAULT 'none',
    `scoresJson` LONGTEXT NULL,
    `winRate` DOUBLE NOT NULL,
    `totalPnl` DOUBLE NOT NULL,
    `profitFactor` DOUBLE NOT NULL,
    `sharpeRatio` DOUBLE NOT NULL,
    `maxDrawdown` DOUBLE NOT NULL,
    `averageReturn10d` DOUBLE NULL,
    `maxReturn10d` DOUBLE NULL,
    `avgTradePnl` DOUBLE NOT NULL,
    `slippage` DOUBLE NULL,
    `spread` DOUBLE NULL,
    `commission` DOUBLE NULL,
    `positionModel` VARCHAR(30) NULL,
    `accountSize` DOUBLE NULL,
    `riskPct` DOUBLE NULL,
    `fixedAmount` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `BacktestRun_symbolId_protocolId_idx`(`symbolId`, `protocolId`),
    INDEX `BacktestRun_createdAt_idx`(`createdAt`),
    INDEX `BacktestRun_periodId_idx`(`periodId`),
    INDEX `BacktestRun_experimentId_iteration_idx`(`experimentId`, `iteration`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backtest_experiment` (
    `id` VARCHAR(36) NOT NULL,
    `protocolId` VARCHAR(100) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `goal` TEXT NULL,
    `windowLabel` VARCHAR(120) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'running',
    `createdBy` VARCHAR(60) NOT NULL DEFAULT 'owner',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `backtest_experiment_protocolId_createdAt_idx`(`protocolId`, `createdAt`),
    INDEX `backtest_experiment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol_directive_change` (
    `id` VARCHAR(36) NOT NULL,
    `protocolSlug` VARCHAR(100) NOT NULL,
    `directiveId` VARCHAR(100) NOT NULL,
    `field` VARCHAR(40) NOT NULL,
    `oldValue` VARCHAR(200) NULL,
    `newValue` VARCHAR(200) NULL,
    `source` VARCHAR(60) NOT NULL DEFAULT 'api',
    `configVersion` INTEGER NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `protocol_directive_change_protocolSlug_configVersion_idx`(`protocolSlug`, `configVersion`),
    INDEX `protocol_directive_change_directiveId_changedAt_idx`(`directiveId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backtest_period` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `note` TEXT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `timeframe` VARCHAR(10) NOT NULL,
    `fromDate` DATETIME(3) NOT NULL,
    `toDate` DATETIME(3) NOT NULL,
    `provider` VARCHAR(50) NULL,
    `barCount` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `backtest_period_symbolId_timeframe_fromDate_idx`(`symbolId`, `timeframe`, `fromDate`),
    INDEX `backtest_period_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BacktestTrade` (
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `entryDate` DATETIME(3) NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `exitDate` DATETIME(3) NOT NULL,
    `exitPrice` DOUBLE NOT NULL,
    `direction` VARCHAR(10) NOT NULL,
    `pnl` DOUBLE NOT NULL,
    `pnlPct` DOUBLE NOT NULL,
    `exitReason` VARCHAR(20) NOT NULL,
    `entryScore` DOUBLE NOT NULL,
    `signal` VARCHAR(20) NOT NULL,
    `stopLoss` DOUBLE NULL,
    `takeProfit` DOUBLE NULL,
    `positionSize` DOUBLE NULL,
    `commission` DOUBLE NULL,
    `maxAdversePct` DOUBLE NULL,
    `maxFavourablePct` DOUBLE NULL,
    `barsHeld` INTEGER NULL,
    `spansGap` BOOLEAN NULL,

    INDEX `BacktestTrade_runId_idx`(`runId`),
    INDEX `BacktestTrade_symbolId_idx`(`symbolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderHealth` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `message` TEXT NULL,
    `latencyMs` INTEGER NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `credentialsOk` BOOLEAN NOT NULL DEFAULT false,
    `endpoint` VARCHAR(500) NULL,

    UNIQUE INDEX `ProviderHealth_provider_key`(`provider`),
    INDEX `ProviderHealth_status_checkedAt_idx`(`status`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiActivityLog` (
    `id` VARCHAR(36) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `endpoint` VARCHAR(220) NOT NULL,
    `method` VARCHAR(12) NOT NULL,
    `provider` VARCHAR(80) NULL,
    `statusCode` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `responseSize` INTEGER NOT NULL DEFAULT 0,

    INDEX `ApiActivityLog_timestamp_idx`(`timestamp`),
    INDEX `ApiActivityLog_provider_timestamp_idx`(`provider`, `timestamp`),
    INDEX `ApiActivityLog_statusCode_timestamp_idx`(`statusCode`, `timestamp`),
    INDEX `ApiActivityLog_method_endpoint_idx`(`method`, `endpoint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FaqEntry` (
    `id` VARCHAR(36) NOT NULL,
    `question` TEXT NOT NULL,
    `answer` TEXT NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `tags` VARCHAR(500) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FaqEntry_category_order_idx`(`category`, `order`),
    INDEX `FaqEntry_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiTrace` (
    `id` VARCHAR(36) NOT NULL,
    `cacheKey` VARCHAR(64) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `requestBody` TEXT NULL,
    `statusCode` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NOT NULL DEFAULT 0,
    `responseBody` TEXT NULL,
    `preview` VARCHAR(1000) NULL,
    `error` TEXT NULL,
    `cached` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `ApiTrace_cacheKey_createdAt_idx`(`cacheKey`, `createdAt`),
    INDEX `ApiTrace_createdAt_idx`(`createdAt`),
    INDEX `ApiTrace_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `correlation_pair` (
    `id` VARCHAR(36) NOT NULL,
    `symbol_a` VARCHAR(20) NOT NULL,
    `symbol_b` VARCHAR(20) NOT NULL,
    `correlation` DOUBLE NOT NULL,
    `period_days` INTEGER NOT NULL DEFAULT 90,
    `computed_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `correlation_pair_symbol_a_idx`(`symbol_a`),
    INDEX `correlation_pair_computed_at_idx`(`computed_at`),
    UNIQUE INDEX `correlation_pair_symbol_a_symbol_b_period_days_key`(`symbol_a`, `symbol_b`, `period_days`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SymbolCalibration` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `directiveId` VARCHAR(100) NOT NULL,
    `weightMultiplier` DOUBLE NOT NULL DEFAULT 1.0,
    `reason` VARCHAR(500) NOT NULL,
    `decayModifier` DOUBLE NULL,
    `volatilityAdjustment` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SymbolCalibration_symbol_idx`(`symbol`),
    UNIQUE INDEX `SymbolCalibration_symbol_directiveId_key`(`symbol`, `directiveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NewsSource` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `reliabilityScore` DOUBLE NOT NULL DEFAULT 5.0,
    `patterns` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NewsSource_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleSample` (
    `id` VARCHAR(36) NOT NULL,
    `sourceId` VARCHAR(36) NOT NULL,
    `headline` TEXT NOT NULL,
    `url` VARCHAR(500) NULL,
    `sentiment` DOUBLE NOT NULL DEFAULT 0,
    `fluffScore` DOUBLE NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `ArticleSample_sourceId_publishedAt_idx`(`sourceId`, `publishedAt`),
    INDEX `ArticleSample_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PublishingPattern` (
    `id` VARCHAR(36) NOT NULL,
    `sourceId` VARCHAR(36) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `hourOfDay` INTEGER NOT NULL,
    `avgSentiment` DOUBLE NOT NULL DEFAULT 0,
    `articleCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `PublishingPattern_sourceId_dayOfWeek_hourOfDay_key`(`sourceId`, `dayOfWeek`, `hourOfDay`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NewsArticle` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `sourceId` VARCHAR(36) NOT NULL,
    `category` VARCHAR(50) NOT NULL DEFAULT 'general',
    `headline` TEXT NOT NULL,
    `url` VARCHAR(250) NOT NULL,
    `summary` TEXT NULL,
    `sentiment` DOUBLE NOT NULL DEFAULT 0,
    `impact` VARCHAR(20) NOT NULL DEFAULT 'medium',
    `publishedAt` DATETIME(3) NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `NewsArticle_url_key`(`url`),
    INDEX `NewsArticle_symbol_publishedAt_idx`(`symbol`, `publishedAt`),
    INDEX `NewsArticle_category_publishedAt_idx`(`category`, `publishedAt`),
    INDEX `NewsArticle_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NewsImportRun` (
    `id` VARCHAR(36) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'running',
    `tierId` VARCHAR(50) NULL,
    `symbolsCount` INTEGER NOT NULL DEFAULT 0,
    `fetched` INTEGER NOT NULL DEFAULT 0,
    `newArticles` INTEGER NOT NULL DEFAULT 0,
    `duplicates` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `errorLog` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `completedAt` DATETIME(3) NULL,

    INDEX `NewsImportRun_startedAt_idx`(`startedAt`),
    INDEX `NewsImportRun_tierId_startedAt_idx`(`tierId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `news_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(300) NOT NULL,
    `url` VARCHAR(500) NULL,
    `source` VARCHAR(100) NOT NULL,
    `sourceHash` VARCHAR(32) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `summary` TEXT NULL,
    `symbols` VARCHAR(200) NULL,
    `sentiment` VARCHAR(50) NULL,
    `severity` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `news_item_sourceHash_key`(`sourceHash`),
    INDEX `news_item_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DirectiveOutcome` (
    `id` VARCHAR(36) NOT NULL,
    `directiveId` VARCHAR(100) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `strategyId` VARCHAR(36) NULL,
    `timeframe` VARCHAR(10) NOT NULL,
    `score` DOUBLE NOT NULL,
    `signalClass` VARCHAR(10) NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `predictedAt` DATETIME(3) NOT NULL,
    `priceAtPredict` DOUBLE NOT NULL,
    `priceT15m` DOUBLE NULL,
    `priceT1h` DOUBLE NULL,
    `priceT4h` DOUBLE NULL,
    `priceT24h` DOUBLE NULL,
    `directionCorrect` BOOLEAN NULL,
    `outcomeComputedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `DirectiveOutcome_directiveId_symbol_predictedAt_idx`(`directiveId`, `symbol`, `predictedAt`),
    INDEX `DirectiveOutcome_predictedAt_idx`(`predictedAt`),
    INDEX `DirectiveOutcome_directionCorrect_idx`(`directionCorrect`),
    INDEX `DirectiveOutcome_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketSnapshot` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `endTime` DATETIME(3) NOT NULL,
    `candleData` JSON NOT NULL,
    `directiveScores` JSON NULL,
    `notes` TEXT NULL,
    `starred` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `MarketSnapshot_symbol_idx`(`symbol`),
    INDEX `MarketSnapshot_starred_createdAt_idx`(`starred`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `id` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeatureFlag` (
    `id` VARCHAR(100) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChartSnapshot` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL,
    `indicators` JSON NOT NULL,
    `drawings` JSON NOT NULL,
    `annotations` TEXT NULL,
    `visibleRange` JSON NULL,
    `priceAtTime` DOUBLE NULL,
    `tags` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `ChartSnapshot_symbol_idx`(`symbol`),
    INDEX `ChartSnapshot_symbol_createdAt_idx`(`symbol`, `createdAt`),
    INDEX `ChartSnapshot_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProtocolVersion` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `changes` TEXT NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `previousVersion` VARCHAR(20) NULL,

    INDEX `ProtocolVersion_strategyId_detectedAt_idx`(`strategyId`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MacroIndicator` (
    `id` VARCHAR(36) NOT NULL,
    `indicator` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `unit` VARCHAR(20) NULL,
    `value` DOUBLE NOT NULL,
    `previous` DOUBLE NULL,
    `date` DATETIME(3) NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `MacroIndicator_indicator_key`(`indicator`),
    INDEX `MacroIndicator_category_date_idx`(`category`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FxRate` (
    `id` VARCHAR(36) NOT NULL,
    `pair` VARCHAR(20) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `provider` VARCHAR(50) NOT NULL,

    INDEX `FxRate_pair_timestamp_idx`(`pair`, `timestamp`),
    INDEX `FxRate_provider_timestamp_idx`(`provider`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SymbolTechnical` (
    `id` VARCHAR(36) NOT NULL,
    `symbolId` VARCHAR(36) NOT NULL,
    `timeframe` VARCHAR(20) NOT NULL,
    `indicator` VARCHAR(50) NOT NULL,
    `value` DOUBLE NOT NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `SymbolTechnical_symbolId_timeframe_indicator_idx`(`symbolId`, `timeframe`, `indicator`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataSourcesMeta` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `config` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DataSourcesMeta_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiCredentials` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `apiSecret` TEXT NULL,
    `valid` BOOLEAN NOT NULL DEFAULT false,
    `lastTested` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApiCredentials_provider_label_key`(`provider`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StrategyPerformance` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `winRate` DOUBLE NOT NULL DEFAULT 0,
    `avgReturn` DOUBLE NOT NULL DEFAULT 0,
    `totalPnl` DOUBLE NOT NULL DEFAULT 0,
    `sharpeRatio` DOUBLE NULL,
    `totalTrades` INTEGER NOT NULL DEFAULT 0,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `StrategyPerformance_strategyId_periodEnd_idx`(`strategyId`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserPreferences` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(50) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserPreferences_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Watchlist` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `symbols` JSON NOT NULL,
    `source` VARCHAR(100) NULL,
    `protocolId` VARCHAR(100) NULL,
    `userId` VARCHAR(100) NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'user',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `importedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screener_hit` (
    `id` VARCHAR(36) NOT NULL,
    `ticker` VARCHAR(20) NOT NULL,
    `symbolId` VARCHAR(36) NULL,
    `source` VARCHAR(20) NOT NULL,
    `catalystType` VARCHAR(50) NOT NULL,
    `catalystStrength` DOUBLE NOT NULL DEFAULT 0,
    `sourceReliability` DOUBLE NOT NULL DEFAULT 50,
    `rawPayloadRef` VARCHAR(500) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `screener_hit_ticker_idx`(`ticker`),
    INDEX `screener_hit_source_idx`(`source`),
    INDEX `screener_hit_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `watchlist_item` (
    `id` VARCHAR(36) NOT NULL,
    `watchlistId` VARCHAR(36) NULL,
    `ticker` VARCHAR(20) NOT NULL,
    `symbolId` VARCHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `source` VARCHAR(20) NULL,
    `screenerHitId` VARCHAR(36) NULL,
    `promotedTo` VARCHAR(100) NULL,
    `promotedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `watchlist_item_screenerHitId_key`(`screenerHitId`),
    INDEX `watchlist_item_watchlistId_idx`(`watchlistId`),
    INDEX `watchlist_item_status_idx`(`status`),
    INDEX `watchlist_item_ticker_idx`(`ticker`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CronMeta` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `schedule` VARCHAR(100) NOT NULL,
    `lastRun` DATETIME(3) NULL,
    `nextRun` DATETIME(3) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'idle',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CronMeta_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessMeta` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `pid` INTEGER NULL,
    `port` INTEGER NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'stopped',
    `startedAt` DATETIME(3) NULL,
    `stoppedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProcessMeta_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketSessions` (
    `id` VARCHAR(36) NOT NULL,
    `session` VARCHAR(50) NOT NULL,
    `openTime` VARCHAR(10) NOT NULL,
    `closeTime` VARCHAR(10) NOT NULL,
    `timezone` VARCHAR(50) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `side` VARCHAR(10) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `price` DOUBLE NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'pending',
    `provider` VARCHAR(50) NOT NULL,
    `providerId` VARCHAR(100) NULL,
    `accountId` VARCHAR(100) NULL,
    `error` TEXT NULL,
    `errorCode` VARCHAR(50) NULL,
    `retcode` INTEGER NULL,
    `externalName` VARCHAR(64) NULL,
    `fillingMode` VARCHAR(16) NULL,
    `filledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_symbol_createdAt_idx`(`symbol`, `createdAt`),
    INDEX `Order_createdAt_idx`(`createdAt`),
    INDEX `Order_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `position_intent` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `intent` VARCHAR(20) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `position_intent_provider_symbol_key`(`provider`, `symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Position` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `symbolId` VARCHAR(36) NULL,
    `quantity` DOUBLE NOT NULL,
    `avgPrice` DOUBLE NOT NULL,
    `currentPrice` DOUBLE NULL,
    `pnl` DOUBLE NULL,
    `provider` VARCHAR(50) NOT NULL,
    `accountId` VARCHAR(100) NULL,
    `lastQuotedAt` DATETIME(3) NULL,
    `peakPrice` DOUBLE NULL,
    `peakProfitPct` DOUBLE NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `brokerTicket` VARCHAR(100) NULL,
    `side` VARCHAR(10) NULL,
    `magic` INTEGER NULL,

    INDEX `Position_symbol_idx`(`symbol`),
    INDEX `Position_symbolId_idx`(`symbolId`),
    INDEX `Position_provider_accountId_idx`(`provider`, `accountId`),
    INDEX `Position_brokerTicket_idx`(`brokerTicket`),
    UNIQUE INDEX `Position_provider_brokerTicket_key`(`provider`, `brokerTicket`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trade` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `side` VARCHAR(10) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `entryPrice` DOUBLE NOT NULL,
    `exitPrice` DOUBLE NULL,
    `pnl` DOUBLE NULL,
    `peakPrice` DOUBLE NULL,
    `peakProfitPct` DOUBLE NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'open',
    `provider` VARCHAR(50) NOT NULL,
    `accountId` VARCHAR(100) NULL,
    `strategy` VARCHAR(200) NULL,
    `scoringStrategyId` VARCHAR(36) NULL,
    `origin` VARCHAR(20) NOT NULL DEFAULT 'user',
    `source` VARCHAR(30) NULL,
    `abTestId` VARCHAR(36) NULL,
    `abTestSide` VARCHAR(1) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `ticket` BIGINT NULL,
    `brokerTicket` VARCHAR(100) NULL,
    `sl` DOUBLE NULL,
    `tp` DOUBLE NULL,
    `magic` INTEGER NULL,
    `swap` DOUBLE NULL,
    `commission` DOUBLE NULL,
    `fee` DOUBLE NULL,
    `brokerComment` VARCHAR(200) NULL,
    `closeReason` VARCHAR(60) NULL,
    `signalAgeAtExecutionMinutes` INTEGER NULL,
    `pnlInvalid` INTEGER NULL DEFAULT 0,
    `pnlInvalidReason` TEXT NULL,
    `pnlRaw` DOUBLE NULL,
    `exitPriceRaw` DOUBLE NULL,

    INDEX `Trade_symbol_openedAt_idx`(`symbol`, `openedAt`),
    INDEX `Trade_status_idx`(`status`),
    INDEX `Trade_origin_createdAt_idx`(`origin`, `createdAt`),
    INDEX `Trade_scoringStrategyId_idx`(`scoringStrategyId`),
    INDEX `Trade_brokerTicket_idx`(`brokerTicket`),
    UNIQUE INDEX `Trade_provider_brokerTicket_key`(`provider`, `brokerTicket`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiCalls` (
    `id` VARCHAR(36) NOT NULL,
    `endpoint` VARCHAR(255) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `statusCode` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `responseSize` INTEGER NULL,
    `error` TEXT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `ApiCalls_provider_timestamp_idx`(`provider`, `timestamp`),
    INDEX `ApiCalls_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CacheMeta` (
    `id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(200) NOT NULL,
    `ttl` INTEGER NOT NULL DEFAULT 300,
    `hitCount` INTEGER NOT NULL DEFAULT 0,
    `missCount` INTEGER NOT NULL DEFAULT 0,
    `size` INTEGER NULL,
    `lastHit` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CacheMeta_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DecodedDocument` (
    `id` VARCHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `format` VARCHAR(50) NOT NULL,
    `parsedFields` JSON NOT NULL,
    `extractedSymbols` JSON NOT NULL,
    `sentiment` VARCHAR(20) NULL,
    `analysis` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `DecodedDocument_format_createdAt_idx`(`format`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StrategyMeta` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `instrumentFocus` JSON NOT NULL,
    `expectedReturn` VARCHAR(20) NULL,
    `maxDrawdown` VARCHAR(20) NULL,
    `winRate` VARCHAR(20) NULL,
    `bestCondition` VARCHAR(50) NULL,
    `riskLevel` VARCHAR(20) NOT NULL,
    `timeHorizon` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StrategyMeta_strategyId_key`(`strategyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WatchlistMeta` (
    `id` VARCHAR(36) NOT NULL,
    `watchlistId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `notes` TEXT NULL,

    INDEX `WatchlistMeta_symbol_idx`(`symbol`),
    UNIQUE INDEX `WatchlistMeta_watchlistId_symbol_key`(`watchlistId`, `symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NewsMeta` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NULL,
    `headline` TEXT NOT NULL,
    `source` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NULL,
    `sentiment` DOUBLE NOT NULL DEFAULT 0,
    `fluffScore` DOUBLE NOT NULL DEFAULT 0,
    `impact` VARCHAR(20) NOT NULL DEFAULT 'low',
    `publishedAt` DATETIME(3) NOT NULL,
    `ingestedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `NewsMeta_symbol_publishedAt_idx`(`symbol`, `publishedAt`),
    INDEX `NewsMeta_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderExecution` (
    `id` VARCHAR(36) NOT NULL,
    `orderId` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `providerOrderId` VARCHAR(100) NULL,
    `action` VARCHAR(50) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `filledQty` DOUBLE NULL,
    `filledPrice` DOUBLE NULL,
    `fee` DOUBLE NULL,
    `error` TEXT NULL,
    `executedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `OrderExecution_orderId_idx`(`orderId`),
    INDEX `OrderExecution_provider_executedAt_idx`(`provider`, `executedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tradingplan` (
    `id` VARCHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `type` VARCHAR(50) NOT NULL DEFAULT 'plan',
    `content` JSON NOT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `symbols` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `portfolioSnapshot` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `planstep` (
    `id` VARCHAR(36) NOT NULL,
    `planId` VARCHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `quantity` DOUBLE NULL,
    `targetPrice` DOUBLE NULL,
    `stopLoss` DOUBLE NULL,
    `deadline` DATETIME(3) NULL,
    `conditions` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `executedAt` DATETIME(3) NULL,
    `executedPrice` DOUBLE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `planstep_planId_idx`(`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earnings_event` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NULL,
    `report_date` DATETIME(3) NOT NULL,
    `fiscal_date_ending` DATETIME(3) NULL,
    `eps_estimate` DOUBLE NULL,
    `eps_actual` DOUBLE NULL,
    `revenue_estimate` DOUBLE NULL,
    `revenue_actual` DOUBLE NULL,
    `surprise_percent` DOUBLE NULL,
    `last_year_eps` DOUBLE NULL,
    `last_year_date` DATETIME(3) NULL,
    `market_cap` DOUBLE NULL,
    `time_of_day` VARCHAR(20) NULL,
    `currency` VARCHAR(10) NULL,
    `source` VARCHAR(30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `earnings_event_report_date_idx`(`report_date`),
    INDEX `earnings_event_symbol_report_date_idx`(`symbol`, `report_date`),
    INDEX `earnings_event_source_created_at_idx`(`source`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analyst_target` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `company_name` VARCHAR(200) NULL,
    `current_price` DOUBLE NOT NULL DEFAULT 0,
    `avg_target` DOUBLE NOT NULL DEFAULT 0,
    `high_target` DOUBLE NOT NULL DEFAULT 0,
    `low_target` DOUBLE NOT NULL DEFAULT 0,
    `consensus` VARCHAR(50) NULL,
    `analyst_count` INTEGER NULL,
    `upside` DOUBLE NULL,
    `source` VARCHAR(30) NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `analyst_target_symbol_idx`(`symbol`),
    INDEX `analyst_target_source_fetched_at_idx`(`source`, `fetched_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sources` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(50) NOT NULL,
    `kind` VARCHAR(30) NOT NULL DEFAULT 'earnings',
    `url` VARCHAR(500) NULL,
    `description` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sources_name_key`(`name`),
    UNIQUE INDEX `sources_slug_key`(`slug`),
    INDEX `sources_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earnings_analysis_batch` (
    `id` VARCHAR(36) NOT NULL,
    `source_id` VARCHAR(36) NULL,
    `raw_text` LONGTEXT NOT NULL,
    `entry_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'parsed',
    `created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `earnings_analysis_batch_source_id_created_at_idx`(`source_id`, `created_at`),
    INDEX `earnings_analysis_batch_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `earnings_analysis` (
    `id` VARCHAR(36) NOT NULL,
    `batch_id` VARCHAR(36) NULL,
    `source_id` VARCHAR(36) NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NULL,
    `headline` VARCHAR(255) NULL,
    `report_date` DATETIME(3) NOT NULL,
    `report_time` VARCHAR(40) NULL,
    `report_date_label` VARCHAR(80) NULL,
    `consensus_eps` DOUBLE NULL,
    `consensus_revenue` DOUBLE NULL,
    `consensus_revenue_label` VARCHAR(60) NULL,
    `whisper_eps` DOUBLE NULL,
    `guidance_eps_low` DOUBLE NULL,
    `guidance_eps_high` DOUBLE NULL,
    `guidance_rev_low` DOUBLE NULL,
    `guidance_rev_high` DOUBLE NULL,
    `beat_pct` DOUBLE NULL,
    `beat_side` VARCHAR(10) NULL,
    `short_interest_change_pct` DOUBLE NULL,
    `short_interest_direction` VARCHAR(10) NULL,
    `implied_move_pct` DOUBLE NULL,
    `recent_avg_move_pct` DOUBLE NULL,
    `stock_change_pct` DOUBLE NULL,
    `price_vs_200dma_pct` DOUBLE NULL,
    `dma_200_price` DOUBLE NULL,
    `meta` JSON NULL,
    `raw_text` LONGTEXT NOT NULL,
    `ai_summary` TEXT NULL,
    `parsed_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `created_at` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `earnings_analysis_symbol_report_date_idx`(`symbol`, `report_date`),
    INDEX `earnings_analysis_batch_id_idx`(`batch_id`),
    INDEX `earnings_analysis_source_id_created_at_idx`(`source_id`, `created_at`),
    INDEX `earnings_analysis_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `score_snapshot` (
    `id` VARCHAR(36) NOT NULL,
    `protocolId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `composite` DOUBLE NOT NULL,
    `trading_signal` VARCHAR(16) NOT NULL,
    `rarityPct` DOUBLE NULL,
    `signalPct` DOUBLE NULL,
    `opportunityPct` DOUBLE NULL,
    `snappedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `score_snapshot_protocolId_snappedAt_idx`(`protocolId`, `snappedAt`),
    INDEX `score_snapshot_symbol_snappedAt_idx`(`symbol`, `snappedAt`),
    INDEX `score_snapshot_snappedAt_idx`(`snappedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserStar` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL DEFAULT 'default',
    `itemType` VARCHAR(20) NOT NULL,
    `itemId` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `UserStar_userId_itemType_idx`(`userId`, `itemType`),
    UNIQUE INDEX `UserStar_userId_itemType_itemId_key`(`userId`, `itemType`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_import_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dataType` VARCHAR(50) NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `dateRangeStart` DATETIME(3) NULL,
    `dateRangeEnd` DATETIME(3) NULL,
    `recordsFetched` INTEGER NOT NULL DEFAULT 0,
    `recordsStored` INTEGER NOT NULL DEFAULT 0,
    `recordsSkipped` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `rateLimitHits` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `data_import_log_dataType_idx`(`dataType`),
    INDEX `data_import_log_dataType_status_fetchedAt_idx`(`dataType`, `status`, `fetchedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_snapshot` (
    `id` VARCHAR(36) NOT NULL,
    `snapshotType` VARCHAR(20) NOT NULL,
    `totalValue` DOUBLE NOT NULL,
    `totalCost` DOUBLE NOT NULL,
    `totalPnl` DOUBLE NOT NULL,
    `totalPnlPct` DOUBLE NOT NULL,
    `positionCount` INTEGER NOT NULL,
    `cash` DOUBLE NULL,
    `providerSummary` JSON NOT NULL,
    `takenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `portfolio_snapshot_snapshotType_takenAt_idx`(`snapshotType`, `takenAt`),
    INDEX `portfolio_snapshot_takenAt_idx`(`takenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_snapshot_position` (
    `id` VARCHAR(36) NOT NULL,
    `snapshotId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `avgPrice` DOUBLE NOT NULL,
    `currentPrice` DOUBLE NOT NULL,
    `value` DOUBLE NOT NULL,
    `pnl` DOUBLE NOT NULL,
    `pnlPct` DOUBLE NOT NULL,
    `allocation` DOUBLE NOT NULL,

    INDEX `portfolio_snapshot_position_snapshotId_symbol_idx`(`snapshotId`, `symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trading_strategy` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    `protocolId` VARCHAR(36) NULL,
    `shortProtocolId` VARCHAR(36) NULL,
    `scoringStrategyId` VARCHAR(36) NULL,
    `duplicatedFromId` VARCHAR(36) NULL,
    `magic` INTEGER NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `brokerId` VARCHAR(50) NOT NULL DEFAULT 'mt5',
    `timeframe` VARCHAR(10) NOT NULL DEFAULT '5m',
    `minComposite` DOUBLE NOT NULL DEFAULT 10,
    `minRarityBand` VARCHAR(20) NULL,
    `requireDirection` VARCHAR(10) NULL,
    `slPct` DOUBLE NULL DEFAULT 1.0,
    `tpPct` DOUBLE NULL DEFAULT 1.0,
    `baseSize` DOUBLE NULL DEFAULT 0.01,
    `sizingModel` VARCHAR(20) NULL,
    `sizingRiskPct` DOUBLE NULL,
    `useRaritySizing` BOOLEAN NOT NULL DEFAULT true,
    `maxSize` DOUBLE NULL,
    `maxPositions` INTEGER NOT NULL DEFAULT 1,
    `maxPyramidTiers` INTEGER NOT NULL DEFAULT 1,
    `maxDailyLoss` DOUBLE NULL,
    `allocationAmount` DOUBLE NULL,
    `cooldownMinutes` INTEGER NOT NULL DEFAULT 5,
    `sessionWindow` VARCHAR(120) NULL,
    `exitBeforeUtc` VARCHAR(5) NULL,
    `mode` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `active` BOOLEAN NOT NULL DEFAULT false,
    `hotStockEnabled` BOOLEAN NOT NULL DEFAULT false,
    `hotStockAllocation` DOUBLE NULL,
    `hotStockDetectionMode` VARCHAR(20) NULL,
    `hotStockMaxHoldHours` INTEGER NULL,
    `maxHoldHours` INTEGER NULL,
    `simTslEnabled` BOOLEAN NOT NULL DEFAULT false,
    `simTslActivationPct` DOUBLE NULL,
    `simTslDistancePct` DOUBLE NULL,
    `exhaustionObserveEnabled` BOOLEAN NOT NULL DEFAULT false,
    `exhaustionDecelPct` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trading_strategy_magic_key`(`magic`),
    INDEX `trading_strategy_scoringStrategyId_idx`(`scoringStrategyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategy_protocol` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `protocolId` VARCHAR(100) NOT NULL,
    `role` VARCHAR(10) NOT NULL DEFAULT 'long',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `strategy_protocol_strategyId_idx`(`strategyId`),
    INDEX `strategy_protocol_protocolId_idx`(`protocolId`),
    UNIQUE INDEX `strategy_protocol_strategyId_protocolId_role_key`(`strategyId`, `protocolId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategy_evaluation` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `composite` DOUBLE NOT NULL,
    `signal` VARCHAR(16) NOT NULL,
    `rarityBand` VARCHAR(20) NULL,
    `rarityPct` DOUBLE NULL,
    `direction` VARCHAR(10) NULL,
    `traded` BOOLEAN NOT NULL DEFAULT false,
    `tradeTicket` BIGINT NULL,
    `tradeResult` TEXT NULL,
    `evaluatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `strategy_evaluation_evaluatedAt_idx`(`evaluatedAt`),
    INDEX `strategy_evaluation_strategyId_evaluatedAt_idx`(`strategyId`, `evaluatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProtocolRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `protocolId` VARCHAR(100) NOT NULL,
    `symbols` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `results` JSON NULL,
    `errorMessage` TEXT NULL,
    `coverage` DOUBLE NULL DEFAULT 1.0,
    `degradedProviders` TEXT NULL,
    `runCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,

    INDEX `ProtocolRun_protocolId_idx`(`protocolId`),
    INDEX `ProtocolRun_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scoring_strategy` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    `protocolId` VARCHAR(100) NOT NULL,
    `shortProtocolId` VARCHAR(100) NULL,
    `watchlistName` VARCHAR(100) NOT NULL,
    `watchlistId` VARCHAR(36) NULL,
    `brokerId` VARCHAR(50) NOT NULL DEFAULT 'mt5',
    `mode` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `tradeThreshold` DOUBLE NOT NULL DEFAULT 10,
    `baseSize` DOUBLE NOT NULL DEFAULT 0.01,
    `slPct` DOUBLE NOT NULL DEFAULT 1.0,
    `tpPct` DOUBLE NOT NULL DEFAULT 1.0,
    `maxPyramidTiers` INTEGER NOT NULL DEFAULT 1,
    `slTpInheritance` VARCHAR(20) NOT NULL DEFAULT 'inherit',
    `weightStrategy` VARCHAR(20) NOT NULL DEFAULT 'group-weighted',
    `gateConfig` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `tradingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `activatedAt` DATETIME(3) NULL,
    `hotStockEnabled` BOOLEAN NOT NULL DEFAULT false,
    `hotStockAllocation` DOUBLE NULL,
    `hotStockDetectionMode` VARCHAR(20) NULL,
    `hotStockMaxHoldHours` INTEGER NULL,
    `maxHoldHours` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `scoring_strategy_watchlistId_idx`(`watchlistId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scoring_strategy_protocol` (
    `id` VARCHAR(36) NOT NULL,
    `scoringStrategyId` VARCHAR(36) NOT NULL,
    `protocolSlug` VARCHAR(100) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'primary',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `scoring_strategy_protocol_scoringStrategyId_protocolSlug_key`(`scoringStrategyId`, `protocolSlug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `metastack_snapshot` (
    `id` VARCHAR(36) NOT NULL,
    `scoringStrategyId` VARCHAR(36) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `snapshot` JSON NOT NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `createdBy` VARCHAR(100) NULL,

    INDEX `metastack_snapshot_scoringStrategyId_idx`(`scoringStrategyId`),
    INDEX `metastack_snapshot_scoringStrategyId_version_idx`(`scoringStrategyId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `metastack_change_log` (
    `id` VARCHAR(36) NOT NULL,
    `scoringStrategyId` VARCHAR(36) NOT NULL,
    `fromVersion` VARCHAR(20) NULL,
    `toVersion` VARCHAR(20) NOT NULL,
    `summary` VARCHAR(500) NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `author` VARCHAR(100) NULL,

    INDEX `metastack_change_log_scoringStrategyId_idx`(`scoringStrategyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SymbolProtocolAffinity` (
    `symbol` VARCHAR(20) NOT NULL,
    `protocolId` VARCHAR(100) NOT NULL,
    `avgNormalizedScore` DOUBLE NOT NULL,
    `runCount` INTEGER NOT NULL DEFAULT 1,
    `lastUpdated` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `SymbolProtocolAffinity_symbol_idx`(`symbol`),
    INDEX `SymbolProtocolAffinity_protocolId_idx`(`protocolId`),
    PRIMARY KEY (`symbol`, `protocolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimelineEvent` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'global',
    `brokerId` VARCHAR(50) NULL,
    `symbol` VARCHAR(20) NULL,
    `session` VARCHAR(20) NULL,
    `protocolId` VARCHAR(100) NULL,
    `action` VARCHAR(20) NOT NULL DEFAULT 'info',
    `riskMultiplier` DOUBLE NULL,
    `thresholdAdjust` INTEGER NULL,
    `label` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(10) NULL,
    `color` VARCHAR(10) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `durationMin` INTEGER NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'system',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `TimelineEvent_startsAt_idx`(`startsAt`),
    INDEX `TimelineEvent_symbol_idx`(`symbol`),
    INDEX `TimelineEvent_scope_startsAt_idx`(`scope`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationConfig` (
    `id` VARCHAR(191) NOT NULL,
    `brokerId` VARCHAR(50) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `tradingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `scoreIntervalMs` INTEGER NOT NULL DEFAULT 300000,
    `tradeThreshold` INTEGER NOT NULL DEFAULT 10,
    `requireConfirmation` BOOLEAN NOT NULL DEFAULT true,
    `pauseOnHighImpactEvents` BOOLEAN NOT NULL DEFAULT true,
    `earningsGateHours` INTEGER NOT NULL DEFAULT 48,
    `useSeasonalityData` BOOLEAN NOT NULL DEFAULT true,
    `boostSessionWindows` BOOLEAN NOT NULL DEFAULT true,
    `maxDailyTrades` INTEGER NOT NULL DEFAULT 10,
    `maxConcurrentPos` INTEGER NOT NULL DEFAULT 3,
    `maxLossPerTrade` DOUBLE NOT NULL DEFAULT 50.0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AutomationConfig_brokerId_key`(`brokerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRule` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `config` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bridge_event` (
    `id` VARCHAR(36) NOT NULL,
    `eventType` VARCHAR(30) NOT NULL,
    `account` VARCHAR(50) NULL,
    `server` VARCHAR(100) NULL,
    `balance` DOUBLE NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `bridge_event_eventType_createdAt_idx`(`eventType`, `createdAt`),
    INDEX `bridge_event_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_investigation` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `trigger` VARCHAR(100) NOT NULL,
    `priceAtTime` DOUBLE NOT NULL,
    `priceChangePct` DOUBLE NULL,
    `analystConsensus` VARCHAR(100) NULL,
    `keyFindings` JSON NOT NULL,
    `summary` TEXT NOT NULL,
    `actionItems` JSON NOT NULL,
    `newsCount` INTEGER NOT NULL DEFAULT 0,
    `sources` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `followedUpAt` DATETIME(3) NULL,
    `outcome` TEXT NULL,
    `investigatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `stock_investigation_symbol_investigatedAt_idx`(`symbol`, `investigatedAt`),
    INDEX `stock_investigation_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fund_allocation` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'GBP',
    `source` VARCHAR(50) NOT NULL DEFAULT 'earnings',
    `notes` TEXT NULL,
    `allocations` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trading_style_preference` (
    `id` VARCHAR(36) NOT NULL,
    `styleKey` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(50) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `preferences` JSON NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trading_style_preference_styleKey_key`(`styleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trading_objective` (
    `id` VARCHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(50) NOT NULL,
    `targetAmount` DOUBLE NULL,
    `currentAmount` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'GBP',
    `targetDate` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `priority` INTEGER NOT NULL DEFAULT 50,
    `phase` VARCHAR(20) NOT NULL DEFAULT 'planning',
    `linkedStrategy` VARCHAR(200) NULL,
    `linkedAccount` VARCHAR(100) NULL,
    `isBuiltIn` BOOLEAN NOT NULL DEFAULT false,
    `progressPct` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `trading_objective_status_idx`(`status`),
    INDEX `trading_objective_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MacroSnapshot` (
    `id` VARCHAR(36) NOT NULL,
    `dxyValue` DOUBLE NULL,
    `eurusdValue` DOUBLE NULL,
    `regime` VARCHAR(20) NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `dxyActual` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `MacroSnapshot_createdAt_idx`(`createdAt`),
    INDEX `MacroSnapshot_regime_createdAt_idx`(`regime`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SocialMention` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `redditMentions` INTEGER NOT NULL DEFAULT 0,
    `redditSentiment` DOUBLE NOT NULL DEFAULT 0,
    `twitterMentions` INTEGER NOT NULL DEFAULT 0,
    `twitterSentiment` DOUBLE NOT NULL DEFAULT 0,
    `totalMentions` INTEGER NOT NULL DEFAULT 0,
    `avgSentiment` DOUBLE NOT NULL DEFAULT 0,
    `source` VARCHAR(30) NOT NULL DEFAULT 'finnhub',
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `SocialMention_symbol_fetchedAt_idx`(`symbol`, `fetchedAt`),
    INDEX `SocialMention_fetchedAt_idx`(`fetchedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InsiderTransaction` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `share` INTEGER NOT NULL DEFAULT 0,
    `change` INTEGER NOT NULL DEFAULT 0,
    `transactionDate` DATETIME(3) NOT NULL,
    `transactionCode` VARCHAR(10) NOT NULL,
    `filingDate` DATETIME(3) NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'USD',
    `source` VARCHAR(30) NOT NULL DEFAULT 'finnhub',
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `InsiderTransaction_symbol_transactionDate_idx`(`symbol`, `transactionDate`),
    INDEX `InsiderTransaction_fetchedAt_idx`(`fetchedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyMetric` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `sharesOutstanding` DOUBLE NOT NULL DEFAULT 0,
    `shareChange3m` DOUBLE NOT NULL DEFAULT 0,
    `shareChange12m` DOUBLE NOT NULL DEFAULT 0,
    `marketCap` DOUBLE NOT NULL DEFAULT 0,
    `source` VARCHAR(30) NOT NULL DEFAULT 'finnhub',
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `CompanyMetric_symbol_fetchedAt_idx`(`symbol`, `fetchedAt`),
    INDEX `CompanyMetric_fetchedAt_idx`(`fetchedAt`),
    UNIQUE INDEX `CompanyMetric_symbol_key`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stack_performance` (
    `id` VARCHAR(36) NOT NULL,
    `scoringStrategyId` VARCHAR(36) NOT NULL,
    `totalTrades` INTEGER NOT NULL DEFAULT 0,
    `winningTrades` INTEGER NOT NULL DEFAULT 0,
    `losingTrades` INTEGER NOT NULL DEFAULT 0,
    `totalPnl` DOUBLE NOT NULL DEFAULT 0,
    `grossProfit` DOUBLE NOT NULL DEFAULT 0,
    `grossLoss` DOUBLE NOT NULL DEFAULT 0,
    `maxDrawdown` DOUBLE NOT NULL DEFAULT 0,
    `peakEquity` DOUBLE NOT NULL DEFAULT 0,
    `currentEquity` DOUBLE NOT NULL DEFAULT 0,
    `firstTradeAt` DATETIME(3) NULL,
    `lastTradeAt` DATETIME(3) NULL,
    `runtimeHours` DOUBLE NOT NULL DEFAULT 0,
    `effectivenessRate` DOUBLE NOT NULL DEFAULT 0,
    `profitFactor` DOUBLE NOT NULL DEFAULT 0,
    `winRate` DOUBLE NOT NULL DEFAULT 0,
    `sharpeApprox` DOUBLE NOT NULL DEFAULT 0,
    `rating` DOUBLE NOT NULL DEFAULT 0,
    `fingerprint` VARCHAR(16) NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stack_performance_scoringStrategyId_key`(`scoringStrategyId`),
    INDEX `stack_performance_scoringStrategyId_idx`(`scoringStrategyId`),
    INDEX `stack_performance_rating_idx`(`rating`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decision_log` (
    `id` VARCHAR(36) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `tickNumber` INTEGER NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `decision` VARCHAR(20) NOT NULL,
    `reason` TEXT NULL,
    `compositeRaw` DOUBLE NULL,
    `compositePct` DOUBLE NULL,
    `composite` DOUBLE NULL,
    `signal` VARCHAR(16) NULL,
    `ticket` BIGINT NULL,
    `price` DOUBLE NULL,
    `quantity` DOUBLE NULL,

    INDEX `decision_log_timestamp_idx`(`timestamp`),
    INDEX `decision_log_strategyId_timestamp_idx`(`strategyId`, `timestamp`),
    INDEX `decision_log_symbol_timestamp_idx`(`symbol`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `decision_trail` (
    `id` VARCHAR(36) NOT NULL,
    `tickNumber` INTEGER NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `strategyId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `longProtocolId` VARCHAR(100) NULL,
    `longComposite` DOUBLE NOT NULL DEFAULT 0,
    `longSignal` VARCHAR(16) NULL,
    `shortProtocolId` VARCHAR(100) NULL,
    `shortComposite` DOUBLE NOT NULL DEFAULT 0,
    `shortSignal` VARCHAR(16) NULL,
    `winner` VARCHAR(10) NULL,
    `chosenComposite` DOUBLE NOT NULL DEFAULT 0,
    `finalSignal` VARCHAR(16) NULL,
    `reason` TEXT NULL,
    `actionable` BOOLEAN NOT NULL DEFAULT false,
    `tradeTicket` BIGINT NULL,
    `tradeVolume` DOUBLE NULL,
    `tradePrice` DOUBLE NULL,
    `scoreSnapshotId` VARCHAR(36) NULL,
    `strategyEvalId` VARCHAR(36) NULL,
    `tradeId` VARCHAR(36) NULL,

    INDEX `decision_trail_timestamp_idx`(`timestamp`),
    INDEX `decision_trail_strategyId_tickNumber_idx`(`strategyId`, `tickNumber`),
    INDEX `decision_trail_symbol_timestamp_idx`(`symbol`, `timestamp`),
    INDEX `decision_trail_actionable_idx`(`actionable`),
    INDEX `decision_trail_scoreSnapshotId_idx`(`scoreSnapshotId`),
    INDEX `decision_trail_strategyEvalId_idx`(`strategyEvalId`),
    INDEX `decision_trail_tradeId_idx`(`tradeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stop_adjustment` (
    `id` VARCHAR(36) NOT NULL,
    `tradeTicket` VARCHAR(100) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `oldSl` DOUBLE NULL,
    `newSl` DOUBLE NULL,
    `oldTp` DOUBLE NULL,
    `newTp` DOUBLE NULL,
    `reason` VARCHAR(200) NOT NULL,
    `directiveScores` JSON NULL,
    `adjustedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `stop_adjustment_tradeTicket_idx`(`tradeTicket`),
    INDEX `stop_adjustment_symbol_adjustedAt_idx`(`symbol`, `adjustedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sim_tsl_event` (
    `id` VARCHAR(36) NOT NULL,
    `tradeTicket` VARCHAR(100) NOT NULL,
    `strategyId` VARCHAR(36) NULL,
    `strategyName` VARCHAR(200) NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `event` VARCHAR(30) NOT NULL,
    `entryPrice` DOUBLE NULL,
    `triggerPrice` DOUBLE NULL,
    `price` DOUBLE NULL,
    `profitPct` DOUBLE NULL,
    `distancePct` DOUBLE NULL,
    `activationPct` DOUBLE NULL,
    `action` VARCHAR(30) NOT NULL DEFAULT 'recorded',
    `detail` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `sim_tsl_event_tradeTicket_occurredAt_idx`(`tradeTicket`, `occurredAt`),
    INDEX `sim_tsl_event_symbol_occurredAt_idx`(`symbol`, `occurredAt`),
    INDEX `sim_tsl_event_strategyId_occurredAt_idx`(`strategyId`, `occurredAt`),
    INDEX `sim_tsl_event_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exhaustion_event` (
    `id` VARCHAR(36) NOT NULL,
    `tradeTicket` VARCHAR(100) NOT NULL,
    `strategyId` VARCHAR(36) NULL,
    `strategyName` VARCHAR(200) NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `side` VARCHAR(10) NOT NULL,
    `event` VARCHAR(30) NOT NULL DEFAULT 'observed',
    `entryPrice` DOUBLE NULL,
    `price` DOUBLE NULL,
    `peakPrice` DOUBLE NULL,
    `profitPct` DOUBLE NULL,
    `recentProgressPct` DOUBLE NULL,
    `priorProgressPct` DOUBLE NULL,
    `decelPct` DOUBLE NULL,
    `thresholdPct` DOUBLE NULL,
    `barsUsed` INTEGER NULL,
    `action` VARCHAR(30) NOT NULL DEFAULT 'recorded',
    `detail` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `exhaustion_event_tradeTicket_occurredAt_idx`(`tradeTicket`, `occurredAt`),
    INDEX `exhaustion_event_symbol_occurredAt_idx`(`symbol`, `occurredAt`),
    INDEX `exhaustion_event_strategyId_occurredAt_idx`(`strategyId`, `occurredAt`),
    INDEX `exhaustion_event_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `automation_event` (
    `id` VARCHAR(36) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `tickNumber` INTEGER NOT NULL,
    `strategyId` VARCHAR(36) NULL,
    `symbol` VARCHAR(20) NULL,
    `step` VARCHAR(60) NOT NULL,
    `decision` VARCHAR(20) NULL,
    `detail` TEXT NULL,
    `durationMs` INTEGER NULL,

    INDEX `automation_event_tickNumber_idx`(`tickNumber`),
    INDEX `automation_event_strategyId_tickNumber_idx`(`strategyId`, `tickNumber`),
    INDEX `automation_event_symbol_timestamp_idx`(`symbol`, `timestamp`),
    INDEX `automation_event_step_timestamp_idx`(`step`, `timestamp`),
    INDEX `automation_event_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directive_audit_run` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `days` INTEGER NOT NULL,
    `topCount` INTEGER NOT NULL,
    `refineCount` INTEGER NOT NULL,
    `stubCount` INTEGER NOT NULL,
    `noDataCount` INTEGER NOT NULL,
    `results` JSON NOT NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `directive_audit_run_symbol_runAt_idx`(`symbol`, `runAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `architecture_section` (
    `id` VARCHAR(36) NOT NULL,
    `sectionKey` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `architecture_section_sectionKey_key`(`sectionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `architecture_entry` (
    `id` VARCHAR(36) NOT NULL,
    `sectionId` VARCHAR(36) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `content` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `tags` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `architecture_entry_sectionId_idx`(`sectionId`),
    INDEX `architecture_entry_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `architecture_revision` (
    `id` VARCHAR(36) NOT NULL,
    `entryId` VARCHAR(36) NOT NULL,
    `previousContent` TEXT NOT NULL,
    `changedBy` VARCHAR(20) NOT NULL DEFAULT 'agent',
    `changedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `architecture_revision_entryId_idx`(`entryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capability` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(100) NOT NULL DEFAULT 'General',
    `area` VARCHAR(100) NOT NULL DEFAULT 'Backend',
    `type` VARCHAR(50) NOT NULL DEFAULT 'Service',
    `status` VARCHAR(30) NOT NULL DEFAULT 'ALPHA',
    `notes` TEXT NULL,
    `dataPersistence` VARCHAR(30) NOT NULL DEFAULT 'ephemeral',
    `uiSurfaces` INTEGER NOT NULL DEFAULT 0,
    `pipelineIntegration` VARCHAR(30) NOT NULL DEFAULT 'none',
    `devCompletion` VARCHAR(30) NOT NULL DEFAULT 'partial',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `capability_category_idx`(`category`),
    INDEX `capability_area_idx`(`area`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `global_setting` (
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `research_note` (
    `id` VARCHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol` (
    `id` VARCHAR(36) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    `directionMode` VARCHAR(20) NOT NULL DEFAULT 'LONG_ONLY',
    `tradingStyle` VARCHAR(50) NULL,
    `recommendedTimeframe` VARCHAR(20) NULL,
    `avgHoldTime` VARCHAR(50) NULL,
    `winRateTarget` VARCHAR(20) NULL,
    `idealFor` TEXT NULL,
    `note` TEXT NULL,
    `theory` TEXT NULL,
    `derivedFrom` VARCHAR(100) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `seasonalAffinity` JSON NULL,
    `highestScore` DOUBLE NULL,
    `adaptiveTargetEnabled` BOOLEAN NOT NULL DEFAULT false,
    `adaptiveTargetMax` DOUBLE NULL,
    `adaptiveTargetSamples` INTEGER NOT NULL DEFAULT 0,
    `adaptiveTargetSince` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `protocol_slug_key`(`slug`),
    INDEX `protocol_slug_idx`(`slug`),
    INDEX `protocol_directionMode_idx`(`directionMode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol_score_status` (
    `protocolId` VARCHAR(100) NOT NULL,
    `state` VARCHAR(30) NOT NULL,
    `reason` TEXT NULL,
    `symbolsResolved` INTEGER NOT NULL DEFAULT 0,
    `symbolsScored` INTEGER NOT NULL DEFAULT 0,
    `lastTickAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `protocol_score_status_state_idx`(`state`),
    PRIMARY KEY (`protocolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol_directive_group` (
    `id` VARCHAR(36) NOT NULL,
    `protocolId` VARCHAR(36) NOT NULL,
    `groupId` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 1.0,
    `isRiskGate` BOOLEAN NOT NULL DEFAULT false,
    `minMultiplier` DOUBLE NOT NULL DEFAULT 0.3,
    `maxMultiplier` DOUBLE NOT NULL DEFAULT 1.2,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `protocol_directive_group_protocolId_groupId_key`(`protocolId`, `groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `protocol_directive_entry` (
    `id` VARCHAR(36) NOT NULL,
    `groupId` VARCHAR(36) NOT NULL,
    `directiveId` VARCHAR(100) NOT NULL,
    `maxScore` INTEGER NOT NULL DEFAULT 100,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `protocol_directive_entry_groupId_directiveId_key`(`groupId`, `directiveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `symbol_protocol_assignment` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `protocolId` VARCHAR(36) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,

    INDEX `symbol_protocol_assignment_symbol_idx`(`symbol`),
    UNIQUE INDEX `symbol_protocol_assignment_symbol_protocolId_key`(`symbol`, `protocolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `symbol_route` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `brokerId` INTEGER NOT NULL,
    `brokerSymbol` VARCHAR(50) NULL,
    `provider` VARCHAR(32) NOT NULL DEFAULT 'mt5',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `symbol_route_brokerId_idx`(`brokerId`),
    INDEX `symbol_route_symbol_idx`(`symbol`),
    UNIQUE INDEX `symbol_route_symbol_brokerId_key`(`symbol`, `brokerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_action` (
    `id` VARCHAR(36) NOT NULL,
    `strategyId` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `brokerId` VARCHAR(50) NOT NULL,
    `side` VARCHAR(10) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `composite` DOUBLE NOT NULL,
    `slPct` DOUBLE NULL,
    `tpPct` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',

    INDEX `pending_action_strategyId_idx`(`strategyId`),
    INDEX `pending_action_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Alert` (
    `id` VARCHAR(36) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NULL,
    `severity` VARCHAR(20) NOT NULL DEFAULT 'info',
    `ticker` VARCHAR(20) NULL,
    `link` VARCHAR(500) NULL,
    `acknowledged` BOOLEAN NOT NULL DEFAULT false,
    `dismissed` BOOLEAN NOT NULL DEFAULT false,
    `snoozedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `readAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `repeatCount` INTEGER NOT NULL DEFAULT 1,

    INDEX `Alert_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `Alert_acknowledged_createdAt_idx`(`acknowledged`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_config` (
    `id` VARCHAR(50) NOT NULL,
    `displayName` VARCHAR(100) NOT NULL,
    `supportedStyles` JSON NOT NULL,
    `supportedAssetTypes` JSON NOT NULL,
    `tradingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduled_job` (
    `id` VARCHAR(36) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'queued',
    `priority` INTEGER NOT NULL DEFAULT 50,
    `runAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `recurrence` VARCHAR(20) NULL,
    `recurrenceMs` INTEGER NULL,
    `payload` JSON NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `lastRunAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `scheduled_job_status_runAt_idx`(`status`, `runAt`),
    INDEX `scheduled_job_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ab_pair` (
    `id` VARCHAR(36) NOT NULL,
    `incumbentId` VARCHAR(36) NOT NULL,
    `variantId` VARCHAR(36) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `declaredChange` VARCHAR(120) NULL,
    `falsification` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ab_pair_incumbentId_idx`(`incumbentId`),
    INDEX `ab_pair_state_idx`(`state`),
    UNIQUE INDEX `ab_pair_variantId_key`(`variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ab_test` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `controlStackId` VARCHAR(36) NOT NULL,
    `variantStackId` VARCHAR(36) NOT NULL,
    `symbols` JSON NOT NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `results` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ab_test_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signal_dismissal` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `protocolId` VARCHAR(50) NOT NULL,
    `dismissedUntil` DATETIME(3) NOT NULL,
    `combinedStrength` INTEGER NULL,
    `signalPct` INTEGER NULL,
    `opportunityPct` INTEGER NULL,
    `dismissCount` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `signal_dismissal_dismissedUntil_idx`(`dismissedUntil`),
    UNIQUE INDEX `signal_dismissal_symbol_protocolId_key`(`symbol`, `protocolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signal_rank_snapshot` (
    `id` VARCHAR(36) NOT NULL,
    `symbol` VARCHAR(20) NOT NULL,
    `protocolId` VARCHAR(50) NOT NULL,
    `direction` VARCHAR(10) NOT NULL,
    `rank` INTEGER NOT NULL,
    `combinedStrength` INTEGER NOT NULL,
    `signalPct` INTEGER NULL,
    `opportunityPct` INTEGER NULL,
    `confidence` INTEGER NULL,
    `scoreId` VARCHAR(36) NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `signal_rank_snapshot_runAt_idx`(`runAt`),
    INDEX `signal_rank_snapshot_symbol_protocolId_idx`(`symbol`, `protocolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roadmap_card` (
    `number` INTEGER NOT NULL,
    `columnId` VARCHAR(40) NOT NULL,
    `position` DECIMAL(20, 6) NOT NULL,
    `ownerAgent` VARCHAR(50) NULL,
    `blockedBy` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `roadmap_card_columnId_idx`(`columnId`),
    PRIMARY KEY (`number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roadmap_column` (
    `id` VARCHAR(40) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'sprint',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `strategy_registry` (
    `id` VARCHAR(36) NOT NULL,
    `strategyKey` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'owner',
    `parts` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `strategy_registry_strategyKey_key`(`strategyKey`),
    INDEX `strategy_registry_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_symbol` (
    `id` VARCHAR(36) NOT NULL,
    `brokerId` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `path` VARCHAR(200) NULL,
    `assetClass` VARCHAR(40) NULL,
    `tradeMode` INTEGER NULL,
    `digits` INTEGER NULL,
    `volumeMin` DOUBLE NULL,
    `volumeMax` DOUBLE NULL,
    `registered` BOOLEAN NOT NULL DEFAULT false,
    `spreadPct` DOUBLE NULL,
    `spreadAbs` DOUBLE NULL,
    `spreadQuotedAt` DATETIME(3) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `broker_symbol_brokerId_assetClass_idx`(`brokerId`, `assetClass`),
    INDEX `broker_symbol_brokerId_tradeMode_idx`(`brokerId`, `tradeMode`),
    INDEX `broker_symbol_brokerId_registered_idx`(`brokerId`, `registered`),
    UNIQUE INDEX `broker_symbol_brokerId_name_key`(`brokerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_symbol_sync` (
    `brokerId` INTEGER NOT NULL,
    `state` VARCHAR(30) NOT NULL,
    `reason` TEXT NULL,
    `symbolCount` INTEGER NOT NULL DEFAULT 0,
    `tradeableCount` INTEGER NOT NULL DEFAULT 0,
    `registeredCount` INTEGER NOT NULL DEFAULT 0,
    `lastSyncAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    PRIMARY KEY (`brokerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Directive` ADD CONSTRAINT `Directive_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Score` ADD CONSTRAINT `Score_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Score` ADD CONSTRAINT `Score_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Signal` ADD CONSTRAINT `Signal_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Signal` ADD CONSTRAINT `Signal_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketBar` ADD CONSTRAINT `MarketBar_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketBar` ADD CONSTRAINT `MarketBar_recordingSessionId_fkey` FOREIGN KEY (`recordingSessionId`) REFERENCES `TickRecordingSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportRun` ADD CONSTRAINT `ImportRun_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TickRecordingSession` ADD CONSTRAINT `TickRecordingSession_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BacktestRun` ADD CONSTRAINT `BacktestRun_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BacktestRun` ADD CONSTRAINT `BacktestRun_experimentId_fkey` FOREIGN KEY (`experimentId`) REFERENCES `backtest_experiment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `backtest_period` ADD CONSTRAINT `backtest_period_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BacktestTrade` ADD CONSTRAINT `BacktestTrade_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `BacktestRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArticleSample` ADD CONSTRAINT `ArticleSample_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `NewsSource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PublishingPattern` ADD CONSTRAINT `PublishingPattern_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `NewsSource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NewsArticle` ADD CONSTRAINT `NewsArticle_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `NewsSource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProtocolVersion` ADD CONSTRAINT `ProtocolVersion_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watchlist_item` ADD CONSTRAINT `watchlist_item_watchlistId_fkey` FOREIGN KEY (`watchlistId`) REFERENCES `Watchlist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watchlist_item` ADD CONSTRAINT `watchlist_item_screenerHitId_fkey` FOREIGN KEY (`screenerHitId`) REFERENCES `screener_hit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_symbolId_fkey` FOREIGN KEY (`symbolId`) REFERENCES `Symbol`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `planstep` ADD CONSTRAINT `planstep_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `tradingplan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earnings_analysis_batch` ADD CONSTRAINT `earnings_analysis_batch_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earnings_analysis` ADD CONSTRAINT `earnings_analysis_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `earnings_analysis_batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `earnings_analysis` ADD CONSTRAINT `earnings_analysis_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_snapshot_position` ADD CONSTRAINT `portfolio_snapshot_position_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `portfolio_snapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strategy_protocol` ADD CONSTRAINT `strategy_protocol_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `trading_strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `strategy_evaluation` ADD CONSTRAINT `strategy_evaluation_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `trading_strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `architecture_entry` ADD CONSTRAINT `architecture_entry_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `architecture_section`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `architecture_revision` ADD CONSTRAINT `architecture_revision_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `architecture_entry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `protocol_directive_group` ADD CONSTRAINT `protocol_directive_group_protocolId_fkey` FOREIGN KEY (`protocolId`) REFERENCES `protocol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `protocol_directive_entry` ADD CONSTRAINT `protocol_directive_entry_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `protocol_directive_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `symbol_protocol_assignment` ADD CONSTRAINT `symbol_protocol_assignment_protocolId_fkey` FOREIGN KEY (`protocolId`) REFERENCES `protocol`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

