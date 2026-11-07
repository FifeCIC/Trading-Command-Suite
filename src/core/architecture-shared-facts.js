/**
 * ⚠️ SINGLE SOURCE for the facts both architecture surfaces must agree on.
 *
 * WHY THIS FILE EXISTS (2026-11-07, #1246)
 * ----------------------------------------
 * The repo carries the architecture twice on purpose: `src/core/architecture-reference.js` is the
 * AI-readable module and `src/pages/architecture-framework.data.js` is the human page. That design
 * is fine. What was not fine is that the shared FACTS were declared twice BY HAND and had drifted.
 *
 * `CURRENT_ROUTE_CONTRACTS` moved here first (73 of 268 contracts disagreed). These three followed,
 * and for all three the PAGE was the newer copy:
 *
 *   DATABASE_SCHEMA  the page documented SocialMention, InsiderTransaction and CompanyMetric —
 *                    three tables that exist in the live database — and the reference omitted all
 *                    three. An agent reading the reference got an incomplete schema.
 *   DOMAINS          the page carried MicroTrendDetector and Planner; the reference did not.
 *   SYSTEM_SPINE     the reference still described the automation loop as "(designed, building)"
 *                    and strategies as scored by ScoringStrategy. The page recorded it as Stage 2+3
 *                    of META.Stack, scored via ProtocolGating.
 *
 * ⚠️ WHICH SIDE WINS IS DECIDED PER EXPORT, BY EVIDENCE. For routes the reference was newer; for
 * these three the page was. "Generate one file from the other" would have been right for one and
 * wrong for three, which is why each was adjudicated separately rather than mechanically.
 *
 * ⚠️ DELIBERATELY NOT HERE, and do not "fix" them:
 *   CURRENT_SLICE     the page paraphrases on purpose; the two are meant to read differently.
 *   STATUS_SNAPSHOT   the two hold genuinely DIFFERENT changelog histories — two records, not one
 *                     fact with two spellings.
 *
 * ⚠️ `plannedMetaTables` inside DATABASE_SCHEMA is a list of tables that are PLANNED, not present.
 * Measured 2026-11-07: SymbolMeta, SymbolFundamentals, LoopTick, EarningsAnalysis,
 * EarningsAnalysisBatch and Source all sit there, so their absence from the live database is
 * correct and must not be "fixed" by deleting them. `paper_trade` IS real — a raw SQL table, and its
 * entry says so.
 */

export const DATABASE_SCHEMA = {
  coreEntities: [
    {
      table: 'Symbol',
      description: 'Trading symbols and company data',
      fields: ['id (PK)', 'ticker (unique)', 'name', 'exchange', 'type', 'active', 'createdAt', 'updatedAt', 'exchange (NULLABLE, 2026-09-23)'],
      relationships: [
        '→ Score (one-to-many)',
        '→ Signal (one-to-many)',
        '→ MarketBar (one-to-many)',
        '→ ImportRun (one-to-many)',
      ],
    },
    {
      table: 'Strategy',
      description: 'Trading strategies and rules',
      fields: ['id (PK)', 'name', 'description', 'config (JSON)', 'active', 'createdAt', 'updatedAt'],
      relationships: [
        '→ Directive (one-to-many)',
        '→ Score (one-to-many)',
        '→ Signal (one-to-many)',
      ],
    },
    {
      table: 'Directive',
      description: 'Scoring directive definitions',
      fields: ['id (PK)', 'strategyId (FK)', 'name', 'type', 'weight', 'config (JSON)', 'active', 'createdAt', 'updatedAt'],
      relationships: [
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'Score',
      description: 'Symbol scoring history',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'value', 'breakdown (JSON)', 'timestamp'],
      relationships: [
        '← Symbol (many-to-one)',
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'Signal',
      description: 'Trading signal records',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'type', 'strength', 'price', 'reason (JSON)', 'status', 'createdAt'],
      relationships: [
        '← Symbol (many-to-one)',
        '← Strategy (many-to-one)',
      ],
    },
    {
      table: 'SymbolCalibration',
      description: 'Symbol/directive weight overrides',
      fields: ['id (PK)', 'symbol (unique with directiveId)', 'directiveId', 'weightMultiplier', 'reason', 'decayModifier', 'volatilityAdjustment', 'createdAt', 'updatedAt'],
      relationships: [],
      status: 'implemented',
    },
    {
      table: 'FaqEntry',
      description: 'FAQ search index',
      fields: ['id (PK)', 'question', 'answer', 'category', 'tags', 'order', 'createdAt', 'updatedAt'],
      relationships: [],
      status: 'implemented',
    },
  ],
  marketDataEntities: [
    {
      table: 'MarketBar',
      description: 'OHLCV price data from imports',
      fields: ['id (PK)', 'symbolId (FK)', 'provider', 'timeframe', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'importedAt'],
      relationships: [
        '← Symbol (many-to-one)',
      ],
      indexes: ['symbolId + timeframe + timestamp', 'provider + importedAt'],
    },
    {
      table: 'ImportRun',
      description: 'Data import job tracking',
      fields: ['id (PK)', 'symbolId (FK)', 'provider', 'timeframe', 'status', 'source', 'requestedAt', 'startedAt', 'completedAt', 'error'],
      relationships: [
        '← Symbol (many-to-one)',
      ],
      indexes: ['symbolId + requestedAt', 'status + requestedAt'],
    },
    {
      table: 'ProviderHealth',
      description: 'Provider connectivity status',
      fields: ['id (PK)', 'provider (unique)', 'status', 'message', 'latencyMs', 'checkedAt', 'credentialsOk', 'endpoint'],
      relationships: [],
      indexes: ['status + checkedAt'],
    },
    {
      table: 'ApiActivityLog',
      description: 'API request telemetry for activity feed, error dot, endpoint usage, and latency charts',
      fields: ['id (PK)', 'timestamp', 'endpoint', 'method', 'provider', 'statusCode', 'durationMs', 'responseSize'],
      relationships: [],
      indexes: ['timestamp', 'provider + timestamp', 'statusCode + timestamp', 'method + endpoint'],
    },
    {
      table: 'SocialMention',
      description: 'Social media sentiment from Reddit/Twitter via Finnhub. Populated by ResearchImportService cron (every 6h). Consumed by social-buzz directive.',
      fields: ['id (PK)', 'symbol', 'redditMentions', 'redditSentiment', 'twitterMentions', 'twitterSentiment', 'totalMentions', 'avgSentiment', 'source', 'fetchedAt'],
      relationships: [],
      indexes: ['symbol + fetchedAt', 'fetchedAt'],
      status: 'implemented (2026-07-03)',
    },
    {
      table: 'InsiderTransaction',
      description: 'Insider buying/selling records via Finnhub. Populated by ResearchImportService cron (every 12h). Consumed by insider-activity directive.',
      fields: ['id (PK)', 'symbol', 'name', 'share', 'change', 'transactionDate', 'transactionCode', 'filingDate', 'currency', 'source', 'fetchedAt'],
      relationships: [],
      indexes: ['symbol + transactionDate', 'fetchedAt'],
      status: 'implemented (2026-07-03)',
    },
    {
      table: 'CompanyMetric',
      description: 'Share dilution and market cap via Finnhub. Populated by ResearchImportService cron (daily 08:00). Consumed by dilution-impact directive.',
      fields: ['id (PK)', 'symbol (unique)', 'sharesOutstanding', 'shareChange3m', 'shareChange12m', 'marketCap', 'source', 'fetchedAt'],
      relationships: [],
      indexes: ['symbol + fetchedAt', 'fetchedAt'],
      status: 'implemented (2026-07-03)',
    },
    {
      table: 'AbTest',
      description: 'A/B test runner — MetaStack side-by-side comparison (#482). References two snapshot ids (control/variant); 1-active + max-4-symbol limits enforced by AbTestService; results aggregated from Trade.abTestId.',
      fields: ['id (PK)', 'controlSnapshotId', 'variantSnapshotId', 'symbol', 'status (created/running/stopped)', 'startedAt', 'stoppedAt', 'createdAt'],
      relationships: ['→ Trade (via abTestId)'],
      status: 'implemented (2026-08-16)',
    },
    {
      table: 'ScheduledJob',
      description: 'Unified DB-driven job queue (#614 Phase 0). JobQueueService polls due jobs once per automation tick; priority ordering, retry backoff, interval rescheduling.',
      fields: ['id (PK)', 'type', 'payload (JSON)', 'status (queued/processing/failed)', 'runAt', 'attempts', 'maxAttempts', 'lastError', 'intervalMs', 'createdAt'],
      relationships: [],
      status: 'implemented (2026-08-16)',
    },
    {
      table: 'ScreenerHit',
      description: 'One normalised catalyst event (attention) — source-agnostic screener contract (#645). Populated by ScreenerService from news_item/newsarticle/earnings_event; dedupe by (source, ticker, rawPayloadRef).',
      fields: ['id (PK)', 'ticker', 'symbolId?', 'source', 'catalystType', 'catalystStrength', 'sourceReliability', 'rawPayloadRef', 'timestamp'],
      relationships: [],
      status: 'implemented (2026-08-17)',
    },
    {
      table: 'WatchlistItem',
      description: 'Per-symbol attention lifecycle (new|watching|promoted|expired). Part of the screener contract; Watchlist.items relation.',
      fields: ['id (PK)', 'watchlistId?', 'ticker', 'symbolId?', 'status', 'source?', 'screenerHitId?', 'promotedTo?', 'promotedAt?', 'expiresAt?'],
      relationships: ['watchlistId → Watchlist.id'],
      status: 'implemented (2026-08-17)',
    },
    {
      table: 'SignalDismissal',
      description: 'Per-signal dismissal from the best-of ladder (#684). symbol+protocolId unique (protocolId nullable = symbol-wide); dismissedUntil index drives hide-for-horizon (1-168h). Enriched (#693, 2026-09-02) with dismissal-time strength snapshot: combinedStrength/signalPct/opportunityPct + dismissCount.',
      fields: ['id (PK)', 'symbol', 'protocolId?', 'dismissedUntil', 'combinedStrength?', 'signalPct?', 'opportunityPct?', 'dismissCount', 'createdAt'],
      relationships: [],
      status: 'implemented (2026-08-26; enriched #693)',
    },
    {
      table: 'NewsItem',
      description: 'RSS-scraped news rows mapped into ScreenerHit news-mention hits (#648). news_item bootstrap DDL added (was missing).',
      fields: ['id (PK)', 'source', 'ticker', 'headline', 'url', 'rawPayloadRef', 'publishedAt'],
      relationships: [],
      status: 'implemented (2026-08-20)',
    },
    {
      table: 'ResearchNote',
      description: 'Research Notes free-text notes with ticker detection + reorder (research_note). Backend ResearchNotesController at /api/research/notes.',
      fields: ['id (PK)', 'content', 'sortOrder', 'createdAt', 'updatedAt'],
      relationships: [],
      status: 'implemented (2026-08-22)',
    },
    {
      table: 'ProtocolScoreStatus',
      description: 'Loop-owned runtime scoring state per protocol (protocol_score_status): scoring | no-symbols | no-data | paused | error. Row absent = pending; active=0 derives disabled. protocol.note holds human-readable explanation.',
      fields: ['id (PK)', 'protocolId', 'status', 'note', 'updatedAt'],
      relationships: ['→ Protocol (protocolId)'],
      status: 'implemented (2026-08-20)',
    },
    {
      table: 'EarningsEvent',
      description: 'Upcoming earnings dates (earnings_event). Now multi-source: Finnhub (chunked 10-day windows) + Nasdaq keyless fallback. ~5,533 events covering 2026-08-24 → 2026-11-20. Import honors settings (scope/minMarketCap/timeOfDay/horizonMonths).',
      fields: ['id (PK)', 'symbol', 'reportDate', 'estimate', 'source', 'importedAt'],
      relationships: [],
      status: 'implemented (2026-08-22)',
    },
    {
      table: 'PaperTrade',
      description: 'Dry-run "would-have-traded" capture (#695). paper_trade is a RAW SQL table — NOT in schema.prisma ("prisma db push broken"); created via raw DDL. Written while trading OFF; dedupe by strategy|symbol.',
      fields: ['id (PK)', 'strategyId', 'symbol', 'side', 'composite', 'entryPrice', 'sl', 'tp', 'baseSize', 'protocolId', 'tickNumber', 'createdAt'],
      relationships: [],
      status: 'implemented (2026-09-02) — raw SQL, not in schema.prisma',
    },
    {
      table: 'StrategySignalQueue',
      description: 'Expert Trading Bot queue (#714 S1) — one pending entry per strategyId+protocolId+symbol carrying the full SEES snapshot (compositePct, signalPct, opportunityPct, combinedStrength, scoreId); status pending/executing. Routed from buildBestLadder() (the single scoring line). strategy_signal_queue is a RAW SQL table — NOT in schema.prisma.',
      fields: ['strategyId + protocolId + symbol (unique pending entry)', 'compositePct', 'signalPct', 'opportunityPct', 'combinedStrength', 'scoreId', 'status (pending/executing)'],
      relationships: [],
      status: 'implemented (2026-09-02) — raw SQL, not in schema.prisma',
    },
    {
      table: 'StrategyProtocol',
      description: 'Multi-protocol signal subscriptions for a trading strategy (#712). strategyId + protocolId + role (long|short|both) + sortOrder; TradingStrategy 1─n. In schema.prisma (StrategyProtocol model). Loop routing via queue subscriptions with fallback to legacy protocolId/shortProtocolId.',
      fields: ['strategyId (FK)', 'protocolId (FK)', 'role (long|short|both)', 'sortOrder'],
      relationships: ['→ TradingStrategy (strategyId)', '→ Protocol (protocolId)'],
      status: 'implemented (2026-09-02)',
    },
    {
      table: 'SignalRankSnapshot',
      description: 'Hourly best-of rank persistence (#693): rank, symbol, protocol, direction, strengths, scoreId. In schema.prisma.',
      fields: ['rank', 'symbol', 'protocol', 'direction', 'strengths (JSON)', 'scoreId'],
      relationships: [],
      status: 'implemented (2026-09-02) — hourly cadence',
    },
  ],
  plannedMetaTables: [
    {
      table: 'SymbolMeta',
      description: 'Extended symbol metadata',
      fields: ['id (PK)', 'symbolId (FK)', 'metaKey', 'metaValue', 'source', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'SymbolFundamentals',
      description: 'Fundamental data (PE, EPS, etc.)',
      fields: ['id (PK)', 'symbolId (FK)', 'metricName', 'metricValue', 'metricText', 'period', 'reportDate', 'source', 'createdAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'SymbolTechnical',
      description: 'Technical indicators by timeframe',
      fields: ['id (PK)', 'symbolId (FK)', 'indicatorName', 'indicatorValue', 'timeframe', 'calculationDate', 'source', 'createdAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'ApiCalls',
      description: 'API call tracking for rate limiting',
      fields: ['id (PK)', 'provider', 'endpoint', 'callTime', 'responseCode', 'responseTimeMs', 'cacheHit', 'errorMessage'],
      relationships: [],
    },
    {
      table: 'DataSourcesMeta',
      description: 'Data source configurations',
      fields: ['id (PK)', 'sourceName', 'sourceType', 'configKey', 'configValue', 'isActive', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'ApiCredentials',
      description: 'Encrypted API credentials',
      fields: ['id (PK)', 'provider (unique with type)', 'credentialType', 'encryptedValue', 'isActive', 'expiresAt', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'CacheMeta',
      description: 'Cache metadata for intelligent invalidation and future queue-based warming',
      fields: ['id (PK)', 'cacheKey (unique)', 'cacheGroup', 'dataType', 'symbolId (FK)', 'expiresAt', 'invalidationTriggers', 'createdAt'],
      relationships: [],
    },
    {
      table: 'StrategyMeta',
      description: 'Strategy parameters and configs',
      fields: ['id (PK)', 'strategyId (FK)', 'parameterName', 'parameterValue', 'parameterType', 'isRequired', 'updatedAt'],
      relationships: ['← Strategy (many-to-one)'],
    },
    {
      table: 'StrategyPerformance',
      description: 'Strategy performance tracking',
      fields: ['id (PK)', 'strategyId (FK)', 'metricName', 'metricValue', 'periodStart', 'periodEnd', 'symbolId (FK)', 'calculatedAt'],
      relationships: ['← Strategy (many-to-one)', '← Symbol (many-to-one)'],
    },
    {
      table: 'UserPreferences',
      description: 'User trading preferences',
      fields: ['id (PK)', 'userId (FK)', 'preferenceKey', 'preferenceValue', 'preferenceType', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'TradingStrategy',
      description: 'Trading strategy definitions with broker binding',
      fields: ['id (PK)', 'name', 'protocolId', 'symbol', 'brokerId (new)', 'timeframe', 'mode (manual/semi-auto/auto)', 'active', 'minComposite', 'slPct', 'tpPct', 'baseSize', 'maxSize', 'cooldownMinutes (new)', 'maxPositions (new)', 'maxDailyTrades (new)', 'pauseOnEvents (new)', 'earningsGateHours (new)', 'useSeasonality (new)', 'createdAt', 'updatedAt', 'duplicatedFromId (varchar 36, 2026-09-22)', 'allocationAmount (double, 2026-09-23)'],
      relationships: [
        '→ StrategyEvaluation (one-to-many)',
      ],
    },
    {
      table: 'StrategyEvaluation',
      description: 'Per-tick strategy evaluation records',
      fields: ['id (PK)', 'strategyId (FK)', 'symbol', 'composite', 'signal', 'rarityBand', 'rarityPct', 'direction', 'traded', 'tradeTicket', 'tradeResult', 'evaluatedAt'],
      relationships: [
        '← TradingStrategy (many-to-one)',
      ],
    },
    {
      table: 'TimelineEvent',
      description: 'Automation timeline events — economic, earnings, sessions, seasonality, system',
      fields: ['id (PK)', 'type', 'scope (global/broker/symbol/session/protocol)', 'brokerId', 'symbol', 'session', 'protocolId', 'action (block/gate/boost/reduce/info)', 'riskMultiplier', 'thresholdAdjust', 'label', 'description', 'startsAt', 'endsAt', 'source', 'metadata (JSON)', 'createdAt'],
      relationships: [],
      indexes: ['startsAt', 'symbol', 'scope + startsAt'],
      status: 'designed',
    },
    {
      table: 'AutomationConfig',
      description: 'Per-broker automation configuration',
      fields: ['id (PK)', 'brokerId', 'enabled', 'tradingEnabled', 'scoreIntervalMs', 'tradeThreshold', 'requireConfirmation', 'pauseOnHighImpactEvents', 'earningsGateHours', 'useSeasonalityData', 'boostSessionWindows', 'maxDailyTrades', 'maxConcurrentPos', 'maxLossPerTrade', 'updatedAt'],
      relationships: [],
      status: 'designed',
    },
    {
      table: 'LoopTick',
      description: 'Automation loop tick audit records',
      fields: ['id (PK)', 'tickNumber', 'startedAt', 'durationMs', 'brokersChecked (JSON)', 'positionsScored', 'strategiesEvaluated', 'tradesExecuted', 'decisions (JSON)', 'activeEvents (JSON)', 'globalRiskMultiplier'],
      relationships: [],
      status: 'designed',
    },
    {
      table: 'DecisionLog',
      description: 'Persistent automation tick decisions — survives restarts. One row per strategy evaluation per tick.',
      fields: ['id (PK)', 'timestamp', 'tickNumber', 'strategyId', 'symbol', 'decision (SCORED/SKIP/EXECUTED/FAILED/BLOCKED/QUEUED/HOLD)', 'reason (text)', 'composite', 'signal (BUY/SELL/HOLD)', 'ticket', 'price', 'quantity', 'ticket (BigInt, 2026-09-22)'],
      relationships: [],
      indexes: ['timestamp', 'strategyId + timestamp', 'symbol + timestamp'],
      status: 'implemented (2026-07-14)',
    },
    {
      table: 'Watchlist',
      description: 'User watchlists (name + JSON symbol array). ⚠️ Currently stored as JSON files in src/data/watchlists/ — DB table exists but is not used by controller. Plan: seed watchlists as part of setup, then work from DB only.',
      fields: ['id (PK)', 'name', 'symbols (JSON array of tickers)', 'userId', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'WatchlistMeta',
      description: 'Per-symbol watchlist entries (normalised). ⚠️ Not used by controller — controller reads/writes filesystem JSON.',
      fields: ['id (PK)', 'watchlistId', 'symbol (ticker)', 'addedAt', 'notes'],
      relationships: ['watchlistId → Watchlist.id'],
    },
    {
      table: 'CronMeta',
      description: 'CRON job metadata and status',
      fields: ['id (PK)', 'jobName (unique)', 'jobStatus', 'lastRun', 'nextRun', 'runCount', 'errorCount', 'lastError', 'configData (JSON)', 'createdAt', 'updatedAt'],
      relationships: [],
    },
    {
      table: 'ProcessMeta',
      description: 'Background process metadata',
      fields: ['id (PK)', 'processName', 'processType', 'status', 'progressPercent', 'totalItems', 'processedItems', 'errorMessage', 'startedAt', 'completedAt', 'createdAt'],
      relationships: [],
    },
    {
      table: 'MarketSessions',
      description: 'Market session information',
      fields: ['id (PK)', 'exchange', 'sessionDate', 'sessionType', 'openTime', 'closeTime', 'isTradingDay', 'notes'],
      relationships: [],
    },
    {
      table: 'NewsMeta',
      description: 'News sentiment metadata',
      fields: ['id (PK)', 'newsId (FK)', 'sentimentScore', 'relevanceScore', 'symbolMentions (JSON)', 'keywords (JSON)', 'sourceReliability', 'analyzedAt'],
      relationships: [],
    },
    {
      table: 'Order',
      description: 'Trading orders',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'orderType', 'side', 'quantity', 'price', 'status', 'createdAt', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)', '← Strategy (many-to-one)'],
    },
    {
      table: 'OrderExecution',
      description: 'Order execution history',
      fields: ['id (PK)', 'orderId (FK)', 'executedQuantity', 'executedPrice', 'executionTime', 'commission', 'executionVenue'],
      relationships: ['← Order (many-to-one)'],
    },
    {
      table: 'Position',
      description: 'Open trading positions',
      fields: ['id (PK)', 'symbolId (FK)', 'quantity', 'averagePrice', 'currentPrice', 'unrealizedPnL', 'openedAt', 'updatedAt'],
      relationships: ['← Symbol (many-to-one)'],
    },
    {
      table: 'Trade',
      description: 'Completed trade records',
      fields: ['id (PK)', 'symbolId (FK)', 'strategyId (FK)', 'entryPrice', 'exitPrice', 'quantity', 'realizedPnL', 'entryTime', 'exitTime', 'duration', 'abTestSide (varchar 1, 2026-09-23)'],
      relationships: ['← Symbol (many-to-one)', '← Strategy (many-to-one)'],
    },
    {
      table: 'Source',
      description: 'Normalised data sources (earnings intel, news, etc.). Every earnings-analysis batch/row references a source by ID so multiple providers (Earnings Whispers, Zacks, Benzinga…) can fill the same schema.',
      fields: ['id (PK)', 'name (unique)', 'slug (unique)', 'kind', 'url', 'description', 'active', 'createdAt', 'updatedAt'],
      relationships: ['→ EarningsAnalysisBatch (one-to-many)', '→ EarningsAnalysis (one-to-many)'],
    },
    {
      table: 'EarningsAnalysisBatch',
      description: 'One row per imported earnings-analysis document (email dump, feed…) from a source. Keeps the raw text + entry count.',
      fields: ['id (PK)', 'sourceId (FK)', 'rawText (LONGTEXT)', 'entryCount', 'status', 'createdAt'],
      relationships: ['← Source (many-to-one)', '→ EarningsAnalysis (one-to-many)'],
    },
    {
      table: 'EarningsAnalysis',
      description: 'Per-symbol parsed earnings-analysis metadata from any source: consensus EPS/revenue, whisper EPS, guidance, beat %, short interest, implied move, vs 200dma. Linked to source + batch. Basis for long-term prediction-accuracy tracking vs EarningsEvent actuals.',
      fields: ['id (PK)', 'batchId (FK)', 'sourceId (FK)', 'symbol', 'name', 'headline', 'reportDate', 'reportTime', 'consensusEps', 'consensusRevenue', 'whisperEps', 'guidanceEpsLow/High', 'guidanceRevLow/High', 'beatPct', 'beatSide', 'shortInterestChangePct', 'shortInterestDirection', 'impliedMovePct', 'recentAvgMovePct', 'stockChangePct', 'priceVs200dmaPct', 'dma200Price', 'meta (JSON)', 'rawText (LONGTEXT)', 'aiSummary', 'parsedAt', 'createdAt'],
      relationships: ['← EarningsAnalysisBatch (many-to-one)', '← Source (many-to-one)'],
    },
      {
        table: 'Alert',
        description: 'Operator-facing alert conditions — one row per CONDITION, not per occurrence (2026-09-23)',
        fields: ['id (PK)', 'type', 'severity', 'symbol', 'message', 'lastSeenAt (2026-09-23)', 'repeatCount (2026-09-23)', 'dismissedAt'],
        relationships: [],
        note: 'lastSeenAt + repeatCount were added because one row per repeat made the bell badge count 12,865 undismissed rows while the popup said "All clear".',
      },
      {
        table: 'backtestrun',
        description: 'One backtest execution — whose configuration produced it, and on what population (2026-09-23)',
        fields: ['id (PK)', 'botId (2026-09-23)', 'botBaseSize (2026-09-23)', 'totalSignals (Int?, 2026-09-23)', 'symbol', 'timeframe', 'totalTrades'],
        relationships: [],
        note: 'botId + botBaseSize record which bot produced a run and the live lot size it used, so a pair comparison can name a size mismatch. totalSignals is the population the winner metric rests on — NULL means not recorded, never zero.',
      },
      {
        table: 'ab_pair',
        description: 'An A/B comparison as a first-class object — incumbent plus variant, with its own lifecycle (NEW 2026-09-23)',
        fields: ['id (PK)', 'incumbentId (FK)', 'variantId (FK, UNIQUE)', 'state (draft|running|complete|abandoned)', 'declaredChange', 'falsification', 'startedAt', 'endedAt'],
        relationships: ['← TradingStrategy (incumbent, many-to-one)', '← TradingStrategy (variant, many-to-one)'],
        note: 'NEW. Comparison state was previously INFERRED from the active flag on two rows. declaredChange and falsification are required to start a run, so a pair cannot be compared with no hypothesis.',
      },

  ],
  keyRelationships: [
    'Symbol is the central entity - connects to scores, signals, market data, and imports',
    'Strategy defines rules - directives execute strategy logic',
    'Score links Symbol + Strategy - stores evaluation results with breakdown',
    'Signal links Symbol + Strategy - actionable trading signals',
    'MarketBar stores OHLCV data - linked to Symbol for price history',
    'ImportRun tracks data imports - linked to Symbol for freshness tracking',
    'SymbolCalibration overrides directive weights per symbol - linked to Symbol + Directive',
    'FaqEntry provides searchable knowledge base - standalone table',
    'DataImportLog tracks every data import — dataType, source, status, record counts, timing, errors, rate limits. Unified audit trail for earnings, dividends, market data.',
    'PortfolioSnapshot stores historical portfolio state with position-level detail for session-over-session comparison (session/daily/weekly snapshots).',
    'PortfolioSnapshotPosition stores per-position data within snapshots (symbol, quantity, avgPrice, currentPrice, value, pnl, pnlPct, allocation) — CASCADE from PortfolioSnapshot.',
    'EarningsEvent stores upcoming earnings dates and estimates from Alpha Vantage with symbol+reportDate lookup.',
    'AnalystTarget stores analyst price targets (high/low/avg/consensus) from Finnhub and FMP per symbol.',
    'SocialMention stores social media sentiment snapshots (Reddit + Twitter mention counts and sentiment) from Finnhub. Populated via ResearchImportService cron (every 6h). Consumed by social-buzz directive.',
    'InsiderTransaction stores insider buying/selling records (name, shares, transaction code, filing date) from Finnhub. Populated via ResearchImportService cron (every 12h). Consumed by insider-activity directive.',
    'CompanyMetric stores share dilution and market cap data (shares outstanding, 3m/12m change %) from Finnhub. Populated via ResearchImportService cron (daily 08:00). Consumed by dilution-impact directive.',
    'ScoreSnapshot stores composite scores with rarity percentiles per protocol for percentile-based rarity bands.',
    'UserStar enables users to favourite/star items across the app (userId + itemType + itemId unique constraint).',
    'Planned: SymbolMeta/Fundamentals/Technical extend Symbol with additional data',
    'Planned: StrategyMeta/Performance extend Strategy with parameters and tracking',
  ],
  dataFlow: [
    '1. Symbol created → 2. ImportRun queued → 3. MarketBar data stored',
    '4. Strategy + Directives defined → 5. Score calculated using MarketBar data',
    '5b. SymbolCalibration applied to directive scores before aggregation (weight multipliers)',
    '5c. DataImportLog records every data import with full audit trail (records, timing, errors, rate limits)',
    '6. Signal generated based on Score → 7. Order created from Signal (planned)',
    '7b. PortfolioSnapshot captures portfolio state at session/daily/weekly intervals',
    '8. EarningsService imports Alpha Vantage EARNINGS_CALENDAR → EarningsEvent table (1 API call → bulk DB)',
    '9. ResearchImportService.importSocialSentiment() (every 6h cron) → Finnhub /social-sentiment → SocialMention table → social-buzz directive reads DB',
    '10. insider-activity directive: DB query → if empty → ResearchImportService.importInsiderTransactionsForSymbol(symbol) on-demand → retry DB → score. Bulk method importInsiderTransactionsBulk() retained for manual use.',
    '11. dilution-impact directive: DB query → if empty → ResearchImportService.importCompanyMetricsForSymbol(symbol) on-demand → retry DB → score. Bulk method importCompanyMetricsBulk() retained for manual use.',
    'ProviderHealth tracked independently - monitors data source availability',
    'Meta tables store extended attributes without modifying core schema',
  ],
}

export const DOMAINS = [
  'Market data import and freshness',
  'Provider integration and health',
  'Directive execution',
  'Calibration and weight overrides',
  'Condition detection and activation gate',
  'MicroTrendDetector (ADX, trend clarity, sideways detection)',
  'Strategy aggregation',
  'Scoring and ranking',
  'Exit signal system',
  'Signals and decision support',
  'Alert center and notifications',
  'Training and pattern detection',
  'SEES presentation layer',
  'Algorithm lab and pipeline visualization',
  'Portfolio and trading execution',
  'Planner (allocations, styles, objectives)',
  'Operational governance and verification',
  'Automation and multi-protocol orchestration',
]

export const SYSTEM_SPINE = [
  'Symbol selected',
  'Freshness checked',
  'Import triggered if stale or missing',
  'Market data stored',
  'Condition detection runs (entropy, Hurst, session, BOS, range)',
  'Activation gate evaluates suitability vs conditions (active/reduced/muted/boosted)',
  'Directives executed (entry + exit), calibration overrides applied',
  'Strategy aggregates directive outputs',
  'Score and breakdown stored',
  'Exit urgency evaluated alongside entry score',
  'SEES ranks symbols',
  'User inspects rationale and timeframe fit',
  '── Automation Loop (Stage 2+3 of META.Stack pipeline) ──',
  'Timeline checked for active events (FOMC, earnings, sessions, seasonality)',
  'Global risk multiplier computed from timeline events',
  'All broker portfolios fetched via AdapterFactory.getBrokerageAdapters()',
  'Every position scored via ProtocolGating (NOT ScoringStrategy — protocols are the scoring unit)',
  'Protocol-gated scores cached and fed into TradingStrategy evaluation',
  'Dispatch: manual→log, semi-auto→queue, auto→execute (with safeties)',
  'Execution via unified IBrokerPortfolio.placeOrder() across any broker',
  'All decisions recorded to LoopTick table for full audit trail',
]
