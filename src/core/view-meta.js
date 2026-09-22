/**
 * View Metadata — maps URL paths to structured view info.
 * Used by the Dev Overlay's "Copy View Info" button.
 * When adding a new page, add an entry here.
 */

const VIEW_META = {
  '/dashboard': {
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/home-dashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
  },
  '/research/symbols-browser': {
    label: 'Symbols Browser',
    file: 'src/pages/SymbolsBrowserPage.jsx',
    css: 'src/pages/symbols-browser.css',
    api: ['GET /api/symbols', 'GET /api/market-data/freshness', 'GET /api/symbols/:ticker/snapshot', 'GET /api/symbols/positions'],
  },
  // #958 — the BROKER's catalogue, not the app's onboarded set. Registered separately because the
  // gap between them (offered vs onboarded) is the capability this page exists to surface; there
  // is deliberately no "merge into Symbols Browser" here.
  '/research/broker-catalogue': {
    label: 'Broker Catalogue',
    file: 'src/pages/BrokerCataloguePage.jsx',
    css: 'src/pages/broker-catalogue.css',
    api: [
      'GET /api/broker-symbols/summary',
      'GET /api/broker-symbols/classes',
      'GET /api/broker-symbols',
      'GET /api/broker-symbols/undiscovered',
      'POST /api/broker-symbols/sync',
    ],
  },
  '/research/screener': {
    label: 'Screener',
    file: 'src/pages/ScreenerPage.jsx',
    css: 'src/pages/screener.css',
    api: ['GET /api/screener/ranked', 'GET /api/screener/hits'],
  },
  '/research/earnings-calendar': {
    label: 'Earnings Calendar',
    file: 'src/pages/EarningsCalendarPage.jsx',
    css: 'src/pages/earnings-calendar.css',
    api: ['GET /api/research/earnings/calendar'],
  },
  '/research/earnings-whispers': {
    label: 'Earnings Whispers',
    file: 'src/pages/EarningsWhispersPage.jsx',
    css: 'src/pages/earnings-whispers.css',
    api: ['POST /api/earnings-whispers/parse', 'GET /api/earnings-whispers'],
  },
  '/research/news-intel': {
    label: 'News Intel',
    file: 'src/pages/NewsIntelPage.jsx',
    css: 'src/pages/news-intel.css',
    api: ['GET /api/news/feed', 'GET /api/news/categories', 'GET /api/news/sentiment-summary', 'GET /api/news/import/last', 'POST /api/news/import/run'],
  },
  // PARAMETERISED DETAIL ROUTE — /research/symbol/:ticker (e.g. /research/symbol/XAUUSD).
  //
  // The key is the PREFIX, with no `:ticker` in it. getViewMeta() (bottom of this file) falls
  // back to a prefix match, longest key first, requiring `pathname.startsWith(key + '/')` — so
  // this key resolves `/research/symbol/ANYTHING` without the parameter being declared here.
  //
  // ⚠️ It does NOT collide with `/research/symbols-browser` above, despite the shared string
  // prefix. Measured, not assumed — and the FIRST mechanism credited here was wrong:
  //   • what actually protects `symbols-browser` is the LONGEST-KEY-FIRST SORT. That key is 25
  //     chars vs this one's 16, so it is tried first and wins outright.
  //   • what the `+ '/'` protects is a path like `/research/symbolfoo` — a string prefix that is
  //     not a child route. Without the slash that would wrongly resolve here.
  // Weakening the matcher to `startsWith(route)` does NOT break `symbols-browser` (canary-tested).
  // Scripts: scripts/verify-view-meta-routes.cjs, scripts/canary-view-meta-routes.cjs.
  //
  // ⚠️ There is deliberately NO nav-tree.js entry for this route, and this is the reason it kept
  // being reported as "needs metadata" by three separate steps. A nav entry is `{ id, label,
  // icon }` and resolves to `/{area}/{id}` — it cannot carry a parameter, so a detail route
  // cannot have one. The component IS registered, as `'symbol'` in view-routes.jsx:307.
  // ⚠️ `/trading/symbol/:ticker` renders the SAME component — see the mirror entry below.
  '/research/symbol': {
    label: 'Symbol Detail',
    file: 'src/pages/SymbolPage.jsx',
    css: 'src/pages/symbol-page.css',
    // ⚠️ CORRECTED 2026-09-21. This listed `GET /api/symbols/:ticker/protocols`, which is a DEAD
    // endpoint: getProtocols() filters on `config.symbols` | `config.symbolFocus` and no
    // `strategy` row populates either (measured: 29 rows, `symbols=null` on every one), so it
    // answers `{"protocols":[],"count":0}` for every symbol — an empty result and a broken one
    // rendered identically (#926). The page switched to `/focus`, which is what it really calls.
    // `/api/signals/envelope/:ticker` also REFUSES to run unscoped (400 TCS-SYS-002, "Pass a
    // protocol"), so it is per-protocol: hence `?protocol=`.
    api: ['GET /api/symbols/:ticker/focus', 'GET /api/signals/envelope/:ticker?protocol=', 'GET /api/symbols/:ticker/overview', 'GET /api/earnings/symbol/:ticker', 'GET /api/news/feed?symbol=:ticker&limit=5'],
  },
  '/education/glossary': {
    label: 'Glossary',
    file: 'src/pages/GlossaryPage.jsx',
    css: 'src/pages/glossary-page.css',
    api: [],
  },
  '/trading/market-context': {
    label: 'Market Context',
    file: 'src/pages/MarketContextPage.jsx',
    css: 'src/pages/market-context.css',
    api: ['GET /api/trading/sessions/market-context', 'GET /api/portfolio', 'GET /api/scoring/runs'],
  },
  '/trading/positions-monitor': {
    label: 'Positions Monitor',
    file: 'src/pages/PositionsMonitorPage.jsx',
    css: 'src/pages/positions-monitor.css',
    api: ['GET /api/portfolio?source=mt5', 'GET /api/portfolio?source=trading212'],
  },
  '/trading/trading-strategies': {
    label: 'Trading Strategies',
    file: 'src/pages/TradingStrategiesPage.jsx',
    css: 'src/pages/trading-strategies.css',
    api: ['GET /api/trading/strategies', 'GET /api/portfolio'],
  },
  '/trading/ab-strategies': {
    label: 'A/B Strategies',
    file: 'src/pages/AbStrategiesPage.jsx',
    css: 'src/pages/ab-strategies.module.css',
    api: ['GET /api/scoring/strategies/derived', 'GET /api/scoring/strategy-registry'],
  },
  '/trading/strategy-comparison': {
    label: 'Trading Strategy Comparison',
    file: 'src/pages/StrategyComparisonPage.jsx',
    css: 'src/pages/strategy-comparison.css',
    api: ['GET /api/trading/strategy-comparison'],
  },
  // PARAMETERISED DETAIL ROUTE — /trading/strategy/:strategyId (one BOT, not one derived strategy).
  // The param is named `strategyId` because `trading_strategy` is the table; the UI name for that
  // row is "bot" (nav-tree calls the list page "Trading Bots", and /trading/bot-create is
  // "Create Bot"). Hence the label below.
  // ⚠️ Prefix-matches `/trading/strategy/ANYTHING` only. `/trading/strategy-comparison`,
  // `/trading/strategy-monitor` and `/trading/strategy-library` live above/below as their own
  // exact keys and win first (exact match is tried before prefix match).
  '/trading/strategy': {
    label: 'Bot Detail',
    file: 'src/pages/ViewStrategyPage.jsx',
    css: 'src/pages/view-strategy.module.css',
    api: ['GET /api/trading/strategies/:id', 'GET /api/trading/strategies/bot-rules', 'GET /api/trading/strategies/:id/protocols'],
  },
  // Same component as '/research/symbol' above — both routes render SymbolPage via the `'symbol'`
  // view id that App.jsx derives from the `:ticker` param. Two URL prefixes, one page, so two
  // keys: getViewMeta() is a keyed lookup on the pathname and cannot know they are the same view.
  '/trading/symbol': {
    label: 'Symbol Detail',
    file: 'src/pages/SymbolPage.jsx',
    css: 'src/pages/symbol-page.css',
    // Kept in step with the '/research/symbol' entry above — same component, same endpoints.
    api: ['GET /api/symbols/:ticker/focus', 'GET /api/signals/envelope/:ticker?protocol=', 'GET /api/symbols/:ticker/overview', 'GET /api/earnings/symbol/:ticker', 'GET /api/news/feed?symbol=:ticker&limit=5'],
  },
  '/trading/trading-bots': {
    label: 'Trading Bots',
    file: 'src/pages/StrategiesListPage.jsx',
    css: 'src/pages/strategies-list.module.css',
    api: ['GET /api/trading/strategies', 'GET /api/portfolio?source=mt5'],
  },
  '/trading/strategy-monitor': {
    label: 'Strategy Monitor',
    file: 'src/pages/StrategyMonitorPage.jsx',
    css: 'src/pages/strategy-monitor.css',
      api: ['GET /api/trading/strategies/with-ratios', 'GET /api/automation/status', 'GET /api/trading/strategy-comparison', 'GET /api/scoring/arena', 'GET /api/scoring/gated/thresholds'],
  },
  '/trading/bot-create': {
    label: 'Create Bot',
    file: 'src/pages/StrategyCreatePage.jsx',
    css: 'src/pages/strategy-create.css',
    api: ['GET /api/scoring/gated/protocols', 'GET /api/watchlists', 'POST /api/trading/strategies'],
  },
  '/lab/dual-protocol-inspector': {
    label: 'Dual-Protocol Inspector',
    file: 'src/pages/ScoringDebugLab.jsx',
    css: 'src/pages/scoring-debug-lab.css',
    api: ['GET /api/scoring/gated/protocols', 'GET /api/scoring/gated/:symbol'],
  },
  '/scoring/protocols-ladder': {
    label: 'Protocols Ladder',
    file: 'src/pages/ProtocolsLadderPage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/scoring/runs'],
  },
  '/scoring/symbols-ladder': {
    label: 'Symbols Ladder',
    file: 'src/pages/SymbolsLadderPage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/scoring/runs'],
  },
  '/protocols/protocols-ladder': {
    label: 'Protocols Ladder',
    file: 'src/pages/ProtocolsLadderPage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/scoring/runs'],
  },
  '/scoring/protocol-builder': {
    label: 'Protocol Builder',
    file: 'src/pages/CreateProtocolsPage.jsx',
    css: 'src/pages/create-protocols.css',
    api: ['GET /api/directives', 'GET /api/watchlists', 'POST /api/scoring/protocols'],
  },
  '/trading/trade-journal': {
    label: 'Trade Journal',
    file: 'src/pages/TradeJournalPage.jsx',
    css: 'src/pages/trade-journal-page.css',
    api: ['GET /api/journal/entries', 'GET /api/journal/stats'],
  },
  '/trading/calculators': {
    label: 'Calculators',
    file: 'src/pages/CalculatorsPage.jsx',
    css: 'src/pages/calculators.css',
    api: [],
  },
  '/trading/accounts-dashboard': {
    label: 'Accounts Dashboard',
    file: 'src/pages/AccountsDashboardPage.jsx',
    css: 'src/pages/accounts-dashboard.css',
    api: ['GET /api/providers/mt5/accounts', 'GET /api/portfolio/summary', 'GET /api/isa/dashboard'],
  },
  '/scoring/directives-registry': {
    label: 'Directives Registry',
    file: 'src/pages/DirectivesManagerPage.jsx',
    css: 'src/pages/directives-manager.css',
    api: ['GET /api/directives'],
  },
  // Canonical URL — part of gradual /scoring/ → /protocols/ migration
  '/protocols/directives-registry': {
    label: 'Directives Registry',
    file: 'src/pages/DirectivesManagerPage.jsx',
    css: 'src/pages/directives-manager.css',
    api: ['GET /api/directives'],
  },
  '/trading/exit-signals': {
    label: 'Exit Signals',
    file: 'src/pages/ExitSignalsPage.jsx',
    css: 'src/pages/exit-signals.css',
    api: ['GET /api/portfolio/exit-signals'],
  },
  '/scoring/sees-arena': {
    label: 'Protocol Comparison',
    file: 'src/pages/SeesArenaPage.jsx',
    css: 'src/pages/sees-arena.css',
    api: ['POST /api/scoring/arena/consensus'],
  },
  '/protocols/sees-arena': {
    label: 'Protocol Comparison',
    file: 'src/pages/SeesArenaPage.jsx',
    css: 'src/pages/sees-arena.css',
    api: ['POST /api/scoring/arena/consensus'],
  },
  // Canonical URL — part of gradual /scoring/ → /protocols/ migration
  '/protocols/protocols-registry': {
    label: 'Protocols Registry',
    file: 'src/pages/ProtocolsPage.jsx',
    css: 'src/pages/protocols.css',
    api: ['GET /api/scoring/gated/protocols', 'GET /api/scoring/protocols'],
  },
  '/protocols/protocol-trail': {
    label: 'Protocol Trail',
    file: 'src/pages/ProtocolTrailPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/scoring/runs'],
  },
  '/scoring/singles-monitor': {
    label: 'Singles Monitor',
    file: 'src/pages/SinglesMonitorPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/scoring/breakdown/:symbol', 'GET /api/automation/status'],
  },
  '/automation/automation-dashboard': {
    label: 'Automation Dashboard',
    file: 'src/pages/AutomationDashboardPage.jsx',
    css: 'src/pages/automation-dashboard.css',
    api: ['GET /api/automation/status', 'POST /api/automation/start', 'POST /api/automation/stop'],
  },
  '/automation/speed-scanner': {
    label: 'Speed Scanner',
    file: 'src/pages/SpeedScannerPage.jsx',
    css: 'src/pages/speed-scanner.css',
    api: ['POST /api/speed/scan'],
  },
  '/automation/automation-rules': {
    label: 'Automation Rules',
    file: 'src/pages/AutomationRulesPage.jsx',
    css: 'src/pages/automation-rules.css',
    api: ['GET /api/automation/rules'],
  },
  '/automation/execution-queue': {
    label: 'Execution Queue',
    file: 'src/pages/ExecutionQueuePage.jsx',
    css: 'src/pages/execution-queue.css',
    api: ['GET /api/automation/status', 'GET /api/trading/mt5/positions'],
  },
  '/automation/alert-center': {
    label: 'Alert Center',
    file: 'src/pages/AlertCenterPage.jsx',
    css: 'src/pages/alert-center.css',
    api: ['GET /api/alerts', 'GET /api/automation/status'],
  },
  '/automation/decision-trail': {
    label: 'Decision Trail',
    file: 'src/pages/DecisionTrailPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/automation/status', 'GET /api/automation/decisions'],
  },
  '/automation/automation-overview': {
    label: 'Automation Overview',
    file: 'src/pages/AutomationOverviewPage.jsx',
    css: 'src/pages/automation-overview.css',
    api: ['GET /api/automation/status', 'GET /api/trading/strategies', 'GET /api/automation/scoring-strategies', 'GET /api/scoring/protocols'],
  },
  '/watchlists/active-symbols': {
    label: 'Active Symbols',
    file: 'src/pages/ActiveSymbolsPage.jsx',
    css: 'src/pages/trading-platforms.css',
    api: ['GET /api/symbols', 'GET /api/portfolio', 'GET /api/directives'],
  },
  '/watchlists/user-watchlists': {
    label: 'Watchlists',
    file: 'src/pages/UserWatchlistsPage.jsx',
    css: 'src/pages/watchlists.css',
    api: ['GET /api/watchlists', 'POST /api/watchlists'],
  },
  '/development/qa-testing': {
    label: 'QA Testing',
    file: 'src/pages/QaTestingPage.jsx',
    css: 'src/pages/qa-testing.css',
    api: [],
  },
  '/status/capability-map': {
    label: 'Capability Map',
    file: 'src/pages/CapabilityMapPage.jsx',
    css: 'src/pages/capability-map.css',
    api: ['GET /api/capabilities', 'GET /api/directives', 'GET /api/providers/health'],
  },
  '/status/health-check': {
    label: 'Health & Diagnostics',
    file: 'src/pages/HealthDashboardPage.jsx',
    css: 'src/pages/health-dashboard.css',
    api: [
      'GET /api/system/health-dashboard',
      'GET /api/system/health-check',
      // Feed Freshness (#841) — served because `starvedSymbols` was computed and had no renderer.
      // Kept as a SEPARATE call from health-dashboard: it is backed by its own short cache on the
      // bar-refresh tick, so it has a different refresh cadence from the rest of the page.
      'GET /api/market-data/bars/refresh/status',
    ],
  },
  '/status/commands': {
    label: 'Commands Reference',
    file: 'src/pages/CommandsReferencePage.jsx',
    css: 'src/pages/commands-reference.css',
    api: [],
  },
  '/builder/architecture-framework': {
    label: 'Architecture Framework',
    file: 'src/pages/ArchitectureFrameworkPage.jsx',
    css: 'src/pages/architecture-framework.css',
    api: ['GET /api/architecture/index', 'GET /api/architecture/section/:key'],
  },
  '/lab/hot-stock-picks': {
    label: 'Hot Stock Picks',
    file: 'src/pages/HotStockPicksPage.jsx',
    css: 'src/pages/hot-stock-picks-page.css',
    api: ['GET /api/scoring/ranked'],
  },
  '/lab/theme-lab': {
    label: 'Theme Lab',
    file: 'src/pages/ThemeLabPage.jsx',
    css: 'src/pages/theme-lab.css',
    api: [],
  },
  '/status/meta-stack-pipeline': {
    label: 'META.Stack Pipeline',
    file: 'src/pages/MetaStackPipelinePage.jsx',
    css: 'src/pages/meta-stack-pipeline.css',
    api: ['GET /api/health'],
  },
  '/settings/settings-database': {
    label: 'Database Settings',
    file: 'src/pages/SettingsDatabasePage.jsx',
    css: 'src/pages/settings-database.css',
    api: ['GET /api/system/config/stats', 'POST /api/system/config/export'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Generated 2026-08-11 — bulk metadata fill for all NAV_TREE-registered views
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Trading ──
  '/trading/trading-plans': {
    label: 'Trading Plans',
    file: 'src/pages/TradingPlansPage.jsx',
    css: 'src/pages/trading-plans-page.css',
    api: [],
  },
  '/trading/strategy-library': {
    label: 'Strategy Library',
    file: 'src/pages/StrategyLibraryPage.jsx',
    css: 'src/pages/strategy-library.css',
    api: [],
  },
  '/trading/performance-lab': {
    label: 'Trading Performance',
    file: 'src/pages/PerformanceLabPage.jsx',
    css: 'src/pages/performance-lab.css',
    api: [],
  },
  '/trading/trading-settings': {
    label: 'Trading',
    file: 'src/pages/TradingSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: [
      'GET /api/signals/trade-defaults', 'PUT /api/signals/trade-defaults',
      'GET /api/scoring/gated/thresholds', 'GET /api/trading/strategies/risk-limits',
      'POST /api/automation/layer',
    ],
  },

  // ── Accounts (trading212) ──
  '/trading212/order-testing': {
    label: 'Order Testing',
    file: 'src/pages/OrderTestingPage.jsx',
    css: 'src/pages/order-test.css',
    api: [],
  },
  '/trading212/t212-portfolio': {
    label: 'Portfolio',
    file: 'src/pages/T212PortfolioPage.jsx',
    css: 'src/pages/t212-portfolio.css',
    api: [],
  },
  '/trading212/t212-isa': {
    label: 'Stocks ISA',
    file: 'src/pages/T212ISAPage.jsx',
    css: 'src/pages/t212-isa.css',
    api: [],
  },
  '/trading212/t212-cfd': {
    label: 'CFD',
    file: 'src/pages/T212CFDPage.jsx',
    css: 'src/pages/t212-cfd.css',
    api: [],
  },

  // ── Protocols ──
  '/protocols/configure-directives': {
    label: 'Protocol Editor',
    file: 'src/pages/DirectivesConfigPage.jsx',
    css: 'src/pages/directives-config.css',
    api: [],
  },

  // ── Scoring ──
  '/scoring/live-ordering-stack': {
    label: 'Ladder',
    file: 'src/pages/LadderPage.jsx',
    css: 'src/pages/ladder.css',
    api: [],
  },
  '/scoring/ab-ladder': {
    label: 'A/B Ladder',
    file: 'src/pages/AbLadderPage.jsx',
    css: 'src/pages/ab-ladder.css',
    api: [],
  },
  '/scoring/scoring-activity-logs': {
    label: 'Scoring Activity Logs',
    file: 'src/pages/ScoringActivityLogsPage.jsx',
    css: 'src/pages/scoring-activity-logs.css',
    api: [],
  },
  '/signals/signals-overview': {
    label: 'Signals',
    file: 'src/pages/SignalsOverviewPage.jsx',
    css: 'src/pages/signals-overview.css',
    api: [],
  },

  // ── Automation (already covered above) ──

  // ── Education ──
  '/education/mt5-demo-trading': {
    label: 'MT5 Demo Trading',
    file: 'src/pages/Mt5TradingPage.jsx',
    css: 'src/pages/mt5-trading-page.css',
    api: [],
  },
  '/education/backtest': {
    label: 'Backtest Engine',
    file: 'src/pages/BacktestPage.jsx',
    css: 'src/pages/backtest-data.css',
    api: [],
  },
  '/education/candle-patterns': {
    label: 'Pattern Detection',
    file: 'src/pages/TrainingCandlePatternsPage.jsx',
    css: 'src/pages/training-candle-patterns-page.css',
    api: [],
  },
  '/education/candle-patterns-guide': {
    label: 'Candle Patterns',
    file: 'src/pages/CandlePatternsGuidePage.jsx',
    css: 'src/pages/candle-patterns-guide.css',
    api: [],
  },

  // ── Status ──
  '/status/setup': {
    label: 'Setup & Diagnostics',
    file: 'src/pages/SetupWizardPage.jsx',
    css: 'src/pages/setup-wizard.css',
    api: [],
  },
  '/status/system-log': {
    label: 'System Log',
    file: 'src/pages/SystemLogPage.jsx',
    css: 'src/pages/system-log.css',
    api: [],
  },
  '/status/platform-comparisons': {
    label: 'API Comparisons',
    file: 'src/pages/PlatformComparisonsPage.jsx',
    css: 'src/pages/platform-comparisons.css',
    api: [],
  },
  '/status/meta-stack-status': {
    label: 'META.Stack Status',
    file: 'src/pages/MetaStackStatusPage.jsx',
    css: 'src/pages/meta-stack-status.css',
    api: [],
  },
  '/status/file-inventory': {
    label: 'File Inventory',
    file: 'src/pages/FileInventoryPage.jsx',
    css: 'src/pages/file-inventory-page.css',
    api: [],
  },

  // ── Lab ──
  '/lab/timeline': {
    label: 'Timeline',
    file: 'src/pages/TradingTimelinePage.jsx',
    css: 'src/pages/trading-timeline-page.css',
    api: [],
  },
  '/lab/mt5-trading': {
    label: 'MT5 Trading (Lab)',
    file: 'src/pages/Mt5TradingPage.jsx',
    css: 'src/pages/mt5-trading-page.css',
    api: [],
  },
  '/lab/strategy-wizard': {
    label: 'Strategy Wizard',
    file: 'src/pages/StrategyWizardPage.jsx',
    css: 'src/pages/strategy-wizard.css',
    api: [],
  },
  '/lab/speed-trading': {
    label: 'Speed Trading',
    file: 'src/pages/SpeedTradingPage.jsx',
    css: 'src/pages/speed-trading.css',
    api: [],
  },
  '/lab/gold-speed': {
    label: 'Gold Speed',
    file: 'src/pages/GoldSpeedTradingPage.jsx',
    css: 'src/pages/speed-cockpit.css',
    api: [],
  },
  '/lab/diagrams': {
    label: 'Diagrams',
    file: 'src/pages/DiagramsPage.jsx',
    css: 'src/pages/diagrams.css',
    api: [],
  },
  '/status/meta-stack-explorer': {
    label: 'META.Stack Explorer',
    file: 'src/pages/MetaStackExplorerPage.jsx',
    css: 'src/pages/meta-stack-explorer.css',
    api: [],
  },
  '/lab/component-lab': {
    label: 'Component Lab',
    file: 'src/pages/ComponentLabPage.jsx',
    css: 'src/pages/component-lab.css',
    api: [],
  },
  // Identity Map — TEMPORARY diagnostic (see IdentityMapLabPage.jsx). Data is a SNAPSHOT in
  // src/data/identity-map.json, rebuilt by `node nest/scripts/identity-map.cjs`. `api: []` is
  // accurate: the page makes no live call, so it cannot go stale against a dead backend —
  // but it CAN go stale against a schema change. Re-run the script after schema edits.
  '/lab/identity-map': {
    label: 'Identity Map',
    file: 'src/pages/IdentityMapLabPage.jsx',
    css: 'src/pages/identity-map-lab.module.css',
    api: [],
  },
  '/lab/widget-library': {
    label: 'Widget Library',
    file: 'src/pages/WidgetBoardLabPage.jsx',
    css: 'src/components/widget-board.css',
    api: ['/api/health', '/api/signals/best', '/api/symbols/positions', '/api/trading/sessions/market-context'],
  },
  '/lab/screen-assignment': {
    label: 'Screen Assignment',
    file: 'src/pages/ScreenCockpitPage.jsx',
    css: 'src/pages/screen-cockpit.css',
    api: [],
  },
  '/lab/responsive-layout-lab': {
    label: 'Responsive Layout Lab',
    file: 'src/pages/ResponsiveLayoutLabPage.jsx',
    css: 'src/pages/responsive-layout-lab.css',
    api: [],
  },
  '/lab/charts-lab': {
    label: 'Charts Lab',
    file: 'src/pages/ChartsLabPage.jsx',
    css: 'src/pages/charts-lab.css',
    api: [],
  },
  '/lab/theme-lab-motion': {
    label: 'Motion Lab',
    file: 'src/pages/ThemeLabMotion.jsx',
    css: 'src/pages/theme-lab-motion.css',
    api: [],
  },
  '/lab/theme-lab-transitions': {
    label: 'Transitions Lab',
    file: 'src/pages/ThemeLabTransitions.jsx',
    css: 'src/pages/theme-lab-transitions.css',
    api: [],
  },
  '/lab/theme-lab-scroll': {
    label: 'Scroll Animations',
    file: 'src/pages/ThemeLabScroll.jsx',
    css: 'src/pages/theme-lab-scroll.css',
    api: [],
  },
  '/lab/theme-lab-popover': {
    label: 'Popover API',
    file: 'src/pages/ThemeLabPopover.jsx',
    css: 'src/pages/theme-lab-popover.css',
    api: [],
  },
  '/lab/lab-landing': {
    label: 'Lab Directory',
    file: 'src/pages/LabLandingPage.jsx',
    css: 'src/pages/lab-landing.css',
    api: [],
  },
  '/lab/pipeline-graph-lab': {
    label: 'Pipeline Graph',
    file: 'src/pages/PipelineGraphLabPage.jsx',
    css: 'src/pages/pipeline-graph-lab.css',
    api: [],
  },
  '/lab/lab': {
    label: 'Lab Sandbox',
    file: 'src/pages/LabPage.jsx',
    css: 'src/pages/lab.css',
    api: [],
  },
  '/lab/feature-lab': {
    label: 'Feature Lab',
    file: 'src/pages/FeatureLabPage.jsx',
    css: 'src/pages/feature-lab.css',
    api: [],
  },
  '/lab/snapshot-replay': {
    label: 'Snapshot Replay',
    file: 'src/pages/SnapshotReplayPage.jsx',
    css: 'src/pages/snapshot-replay.css',
    api: [],
  },
  '/lab/meta-stack-cockpit': {
    label: 'META.Stack Cockpit',
    file: 'src/pages/MetaStackCockpitPage.jsx',
    css: 'src/pages/metastack-cockpit.css',
    api: [],
  },
  '/lab/daily-briefing': {
    label: 'Daily Briefing',
    file: 'src/pages/DailyBriefingPage.jsx',
    css: 'src/pages/daily-briefing.css',
    api: [],
  },
  '/lab/ab-testing': {
    label: 'A/B Protocol Testing',
    file: 'src/pages/ABTestingPage.jsx',
    css: 'src/pages/ab-testing.css',
    api: [],
  },
  '/lab/ai-costs': {
    label: 'AI Costs',
    file: 'src/pages/AICostsPage.jsx',
    css: 'src/pages/ai-costs.css',
    api: [],
  },
  '/lab/daily-summary-report': {
    label: 'Daily Summary Report',
    file: 'src/pages/DailySummaryReportPage.jsx',
    css: 'src/pages/daily-summary-report.css',
    api: [],
  },
  '/lab/portfolio-lab': {
    label: 'Portfolio Lab',
    file: 'src/pages/PortfolioLabPage.jsx',
    css: 'src/pages/portfolio-lab.css',
    api: [],
  },
  '/lab/snapshots': {
    label: 'Snapshots',
    file: 'src/pages/SnapshotLibraryPage.jsx',
    css: 'src/pages/snapshot-library.css',
    api: [],
  },

  // ── Development ──
  '/development/roadmap': {
    label: 'Dynamic Roadmap',
    file: 'src/pages/RoadmapPage.jsx',
    css: 'src/pages/roadmap-page.css',
    api: ['GET /api/roadmap'],
  },
  '/planner/personal-finances': {
    label: 'Personal Finances',
    file: 'src/pages/PersonalFinancesPage.jsx',
    css: 'src/pages/personal-finances.css',
    api: [],
  },
  '/planner/trading-styles': {
    label: 'Trading Styles',
    file: 'src/pages/TradingStylesPage.jsx',
    css: 'src/pages/trading-styles.css',
    api: [],
  },
  '/planner/objectives': {
    label: 'Objectives',
    file: 'src/pages/ObjectivesPage.jsx',
    css: 'src/pages/objectives.css',
    api: [],
  },
  '/lab/allocator': {
    label: 'Strategy Allocator',
    file: 'src/pages/GlobalAllocatorPage.jsx',
    css: 'src/pages/global-allocator.css',
    api: [],
  },

  // ── Settings ──
  '/settings/monitoring': {
    label: 'Monitoring',
    file: 'src/pages/MonitoringPage.jsx',
    css: 'src/pages/settings.css',
    api: ['GET /api/alerts/count', 'GET /api/alerts/settings'],
  },
  '/settings/risk-controls': {
    label: 'Risk Controls',
    file: 'src/pages/RiskControlsPage.jsx',
    css: 'src/pages/risk-controls.css',
    api: [],
  },
  '/settings/settings': {
    label: 'General',
    file: 'src/pages/SettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: ['GET /api/system/settings/health-checks', 'PUT /api/system/settings/health-checks'],
  },
  '/settings/settings-education': {
    label: 'Education',
    file: 'src/pages/SettingsEducationPage.jsx',
    css: 'src/pages/settings-education.css',
    api: [],
  },
  '/settings/theme-packs': {
    label: 'Theme Packs',
    file: 'src/pages/ThemePage.jsx',
    css: 'src/pages/theme-page.css',
    api: [],
  },
  '/settings/user-preferences': {
    label: 'User Preferences',
    file: 'src/pages/PreferenceLab.jsx',
    css: 'src/pages/preference-lab.css',
    api: [],
  },
  '/settings/trading-settings': {
    label: 'Trading',
    file: 'src/pages/TradingSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: [
      'GET /api/signals/trade-defaults', 'PUT /api/signals/trade-defaults',
      'GET /api/scoring/gated/thresholds', 'GET /api/trading/strategies/risk-limits',
      'POST /api/automation/layer',
    ],
  },
  // ── Settings split (#617) — one page per META.Stack layer question ──
  '/settings/appearance': {
    label: 'Appearance',
    file: 'src/pages/AppearanceSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: [],
  },
  '/settings/scoring-settings': {
    label: 'Scoring Settings',
    file: 'src/pages/ScoringSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: ['GET /api/scoring/gated/thresholds', 'POST /api/automation/layer'],
  },
  '/settings/automation': {
    label: 'Automation Settings',
    file: 'src/pages/AutomationSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: [
      'GET /api/automation/status', 'POST /api/automation/start', 'POST /api/automation/stop',
      'POST /api/automation/interval', 'POST /api/automation/emergency-stop',
      'POST /api/automation/layer', 'GET /api/automation/bot-queue',
      'POST /api/automation/bot-queue', 'GET /api/automation/rules',
      'PUT /api/automation/rules/:id',
    ],
  },

  // ── Dashboard ──
  '/dashboard/dashboard': {
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/home-dashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
  },
  '/dashboard/screen': {
    label: 'Screen View',
    file: 'src/pages/ScreenBoardPage.jsx',
    css: 'src/components/widget-board.css',
    api: [],
  },

  // ── Watchlists ──
  '/watchlists/add-symbol': {
    label: 'Add Symbol',
    file: 'src/pages/AddSymbolPage.jsx',
    css: 'src/pages/add-symbol.css',
    api: [],
  },

  // ── REGISTERED 2026-09-22 — the NAV-LEAF METADATA GAP ─────────────────────────────────────────
  // Every sidebar link resolves to `/area/viewId` and the Dev Overlay reports "No metadata
  // registered for this route" when the lookup misses. Measured 2026-09-22 (after the owner hit
  // /trading/strategies-derived): 14 of 125 nav leaves had NO entry — this block registers them
  // all, and `scripts/verify-view-meta-routes.cjs` now ENFORCES coverage, so the next nav link
  // added without metadata fails the verifier instead of landing on the user.
  '/research/research-notes': {
    label: 'Notes',
    file: 'src/pages/ResearchNotesPage.jsx',
    css: 'src/pages/research-notes.css',
    api: [
      'GET /api/research/notes',
      'POST /api/research/notes',
      'PUT /api/research/notes/reorder',
      'GET /api/symbols',
    ],
  },
  '/research/events-calendar': {
    label: 'Events Calendar',
    file: 'src/pages/EventsCalendarPage.jsx',
    css: 'src/pages/events-calendar.css',
    api: [
      'GET /api/research/earnings/calendar',
      'GET /api/automation/timeline?lookahead=240',
      'GET /api/portfolio',
    ],
  },
  '/research/stock-investigation': {
    label: 'Stock Investigation',
    file: 'src/pages/StockInvestigationPage.jsx',
    css: 'src/pages/stock-investigation.css',
    api: ['GET /api/research/investigations?limit=30', 'POST /api/research/investigations'],
  },
  '/research/market-correlations': {
    label: 'Market Correlations',
    file: 'src/pages/MarketCorrelationsPage.jsx',
    css: 'src/pages/market-correlations.css',
    api: ['GET /api/portfolio/correlation'],
  },
  '/research/recently-analysed-symbols': {
    label: 'Recently Analysed',
    file: 'src/pages/RecentlyAnalysedSymbolsPage.jsx',
    css: 'src/pages/recently-analysed.css',
    api: ['GET /api/scoring/recently-analysed?limit=50'],
  },
  '/research/analyse-symbol': {
    label: 'Analyse Symbol',
    file: 'src/pages/AnalyseSymbolPage.jsx',
    css: 'src/pages/analyse-symbol.css',
    api: ['GET /api/symbols', 'GET /api/scoring/ranked?limit=50'],
  },
  '/protocols/protocol-builder': {
    label: 'Protocol Builder',
    file: 'src/pages/CreateProtocolsPage.jsx',
    css: 'src/pages/create-protocols.css',
    api: ['GET /api/directives', 'GET /api/scoring/protocols', 'POST /api/scoring/protocols'],
  },
  '/protocols/directive-viewer': {
    label: 'Directive Viewer',
    file: 'src/pages/DirectiveViewerPage.jsx',
    css: 'src/pages/directive-viewer.css',
    api: ['GET /api/directives/:id/viewer'],
  },
  '/protocols/dual-protocol-inspector': {
    // The nav label is "Dual-Protocol Inspector"; the component file keeps its lab name.
    label: 'Dual-Protocol Inspector',
    file: 'src/pages/ScoringDebugLab.jsx',
    css: 'src/pages/scoring-debug-lab.css',
    api: ['GET /api/scoring/gated/:symbol?protocol&bars&timeframe'],
  },
  '/trading/strategies-derived': {
    label: 'Strategies',
    file: 'src/pages/DerivedStrategiesPage.jsx',
    css: 'src/pages/derived-strategies.module.css',
    api: [
      'GET /api/scoring/strategies/derived',
      'GET /api/scoring/strategy-registry',
      'PATCH /api/scoring/strategy-registry/:id',
      'POST /api/scoring/strategy-registry',
      'POST /api/scoring/strategy-registry/:id/reaccept',
    ],
  },
  '/education/settings-education': {
    label: 'Education Settings',
    file: 'src/pages/SettingsEducationPage.jsx',
    css: 'src/pages/settings.css',
    api: [],
  },
  '/status/architecture-framework': {
    label: 'Architecture',
    file: 'src/pages/ArchitectureFrameworkPage.jsx',
    css: 'src/pages/architecture-framework.css',
    api: [
      'GET /api/architecture/index',
      'GET /api/providers/health',
      'GET /api/health',
      'GET /api/imports/runs?limit=5',
      'GET /api/alerts/count',
      'GET /api/calibrations',
    ],
  },
  // INLINE VIEW — rendered by `App.jsx` renderMainContent() (INLINE_VIEWS: demos, use-cases,
  // analytics, about). It has no page component and no stylesheet of its own; `file` names the
  // shell that renders it so the overlay's component name and "open view file" stay truthful.
  '/status/analytics': {
    label: 'Analytics',
    file: 'src/App.jsx',
    css: 'src/index.css',
    api: [],
  },
  '/lab/position-lifecycle': {
    label: 'Position Lifecycle',
    file: 'src/pages/PositionLifecyclePage.jsx',
    css: 'src/pages/position-lifecycle.css',
    api: ['GET /api/trading/position-lifecycle'],
  },
};

/** Get view metadata from current URL path */
export function getViewMeta(pathname) {
  // Try exact match first
  if (VIEW_META[pathname]) return VIEW_META[pathname];

  // Try prefix match for sub-routes (e.g. /trading/strategy/123 → /trading/strategy)
  // Sort by route length descending so longer (more specific) routes match first
  const routes = Object.keys(VIEW_META).sort((a, b) => b.length - a.length);
  for (const route of routes) {
    if (pathname.startsWith(route + '/')) return VIEW_META[route];
  }

  return null;
}

/** Format view metadata as a copyable string */
export function formatViewMeta(pathname) {
  const meta = getViewMeta(pathname);
  if (!meta) return `View: ${pathname}\n(No metadata registered for this route)`;

  return [
    `View:       ${meta.label}`,
    `Route:      ${pathname}`,
    `File:       ${meta.file}`,
    `CSS:        ${meta.css}`,
    `API:        ${meta.api.join(', ') || 'None'}`,
    `Component:  <${meta.label.replace(/\s+/g, '')} />`,
  ].join('\n');
}

export default VIEW_META;
