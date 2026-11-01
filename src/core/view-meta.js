/**
 * View Metadata — maps URL paths to structured view info.
 * Used by the Dev Overlay's "Copy View Info" button.
 * When adding a new page, add an entry here.
 */

const VIEW_META = {
  '/dashboard': {
    tier: 'free',
    review: 'approved',
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/home-dashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
  },
  '/research/symbols-browser': {
    tier: 'free',
    review: 'approved',
    label: 'Symbols Browser',
    file: 'src/pages/SymbolsBrowserPage.jsx',
    css: 'src/pages/symbols-browser.css',
    api: ['GET /api/symbols', 'GET /api/market-data/freshness', 'GET /api/symbols/:ticker/snapshot', 'GET /api/symbols/positions'],
  },
  // #958 — the BROKER's catalogue, not the app's onboarded set. Registered separately because the
  // gap between them (offered vs onboarded) is the capability this page exists to surface; there
  // is deliberately no "merge into Symbols Browser" here.
  '/status/broker-catalogue': {
    tier: 'premium',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Screener',
    file: 'src/pages/ScreenerPage.jsx',
    css: 'src/pages/screener.css',
    api: ['GET /api/screener/ranked', 'GET /api/screener/hits'],
  },
  '/research/earnings-calendar': {
    tier: 'free',
    review: 'approved',
    label: 'Earnings Calendar',
    file: 'src/pages/EarningsCalendarPage.jsx',
    css: 'src/pages/earnings-calendar.css',
    api: ['GET /api/research/earnings/calendar'],
  },
  '/research/earnings-whispers': {
    tier: 'premium',
    review: 'approved',
    label: 'Earnings Whispers',
    file: 'src/pages/EarningsWhispersPage.jsx',
    css: 'src/pages/earnings-whispers.css',
    api: ['POST /api/earnings-whispers/parse', 'GET /api/earnings-whispers'],
  },
  '/research/news-intel': {
    tier: 'free',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Glossary',
    file: 'src/pages/GlossaryPage.jsx',
    css: 'src/pages/glossary-page.css',
    api: [],
  },
  '/trading/market-context': {
    tier: 'free',
    review: 'approved',
    label: 'Market Context',
    file: 'src/pages/MarketContextPage.jsx',
    css: 'src/pages/market-context.css',
    api: ['GET /api/trading/sessions/market-context', 'GET /api/portfolio', 'GET /api/scoring/runs'],
  },
  '/trading/positions-monitor': {
    tier: 'free',
    review: 'approved',
    label: 'Positions Monitor',
    file: 'src/pages/PositionsMonitorPage.jsx',
    css: 'src/pages/positions-monitor.css',
    api: ['GET /api/portfolio?source=mt5', 'GET /api/portfolio?source=trading212'],
  },
  '/trading/ab-strategies': {
    tier: 'premium',
    review: 'approved',
    label: 'A/B Strategies',
    file: 'src/pages/AbStrategiesPage.jsx',
    css: 'src/pages/ab-strategies.module.css',
    api: ['GET /api/scoring/strategies/derived', 'GET /api/scoring/strategy-registry'],
  },
  '/trading/strategy-comparison': {
    tier: 'premium',
    review: 'approved',
    label: 'Bot Comparison',
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
    tier: 'premium',
    review: 'approved',
    label: 'Bot Detail',
    file: 'src/pages/ViewStrategyPage.jsx',
    css: 'src/pages/view-strategy.module.css',
    api: ['GET /api/trading/strategies/:id', 'GET /api/trading/strategies/bot-rules', 'GET /api/trading/strategies/:id/protocols'],
  },
  // Same component as '/research/symbol' above — both routes render SymbolPage via the `'symbol'`
  // view id that App.jsx derives from the `:ticker` param. Two URL prefixes, one page, so two
  // keys: getViewMeta() is a keyed lookup on the pathname and cannot know they are the same view.
  '/trading/symbol': {
    tier: 'free',
    review: 'approved',
    label: 'Symbol Detail',
    file: 'src/pages/SymbolPage.jsx',
    css: 'src/pages/symbol-page.css',
    // Kept in step with the '/research/symbol' entry above — same component, same endpoints.
    api: ['GET /api/symbols/:ticker/focus', 'GET /api/signals/envelope/:ticker?protocol=', 'GET /api/symbols/:ticker/overview', 'GET /api/earnings/symbol/:ticker', 'GET /api/news/feed?symbol=:ticker&limit=5'],
  },
  '/trading/trading-bots': {
    tier: 'premium',
    review: 'approved',
    label: 'Trading Bots',
    file: 'src/pages/StrategiesListPage.jsx',
    css: 'src/pages/strategies-list.module.css',
    api: ['GET /api/trading/strategies', 'GET /api/portfolio?source=mt5'],
  },
  '/trading/strategy-monitor': {
    tier: 'premium',
    review: 'approved',
    label: 'Bot Monitor',
    file: 'src/pages/StrategyMonitorPage.jsx',
    css: 'src/pages/strategy-monitor.css',
      api: ['GET /api/trading/strategies/with-ratios', 'GET /api/automation/status', 'GET /api/trading/strategy-comparison', 'GET /api/scoring/arena', 'GET /api/scoring/gated/thresholds'],
  },
  '/trading/bot-create': {
    tier: 'premium',
    review: 'approved',
    label: 'Create Bot',
    file: 'src/pages/StrategyCreatePage.jsx',
    css: 'src/pages/strategy-create.css',
    api: ['GET /api/scoring/gated/protocols', 'GET /api/watchlists', 'POST /api/trading/strategies'],
  },


  '/scoring/symbols-ladder': {
    tier: 'premium',
    review: 'approved',
    label: 'Symbols Ladder',
    file: 'src/pages/SymbolsLadderPage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/scoring/runs'],
  },
  '/protocols/protocols-ladder': {
    tier: 'premium',
    review: 'approved',
    label: 'Protocols Ladder',
    file: 'src/pages/ProtocolsLadderPage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/scoring/runs'],
  },

  '/trading/trade-journal': {
    tier: 'free',
    review: 'approved',
    label: 'Trade Journal',
    file: 'src/pages/TradeJournalPage.jsx',
    css: 'src/pages/trade-journal-page.css',
    api: ['GET /api/journal/entries'],
  },
  '/trading/calculators': {
    tier: 'free',
    review: 'approved',
    label: 'Calculators',
    file: 'src/pages/CalculatorsPage.jsx',
    css: 'src/pages/calculators.css',
    api: [],
  },

  // Canonical URL — part of gradual /scoring/ → /protocols/ migration
  '/protocols/directives-registry': {
    tier: 'premium',
    review: 'approved',
    label: 'Directives Registry',
    file: 'src/pages/DirectivesManagerPage.jsx',
    css: 'src/pages/directives-manager.css',
    api: ['GET /api/directives'],
  },
  '/trading/exit-signals': {
    tier: 'premium',
    review: 'approved',
    label: 'Exit Signals',
    file: 'src/pages/ExitSignalsPage.jsx',
    css: 'src/pages/exit-signals.css',
    api: ['GET /api/scoring/exit-consensus'],
  },
  // #988 — new page, so `review: 'pending'` until the owner has looked at it (the editions pass
  // treats an unapproved entry as pending rather than as a failure).
  '/trading/stop-guardian': {
    tier: 'premium',
    review: 'pending',
    label: 'Stop Guardian',
    file: 'src/pages/StopGuardianStatsPage.jsx',
    css: 'src/pages/stop-guardian-stats.css',
    api: ['GET /api/trading/stop-guardian-stats'],
  },

  '/protocols/sees-arena': {
    tier: 'premium',
    review: 'approved',
    label: 'Protocol Comparison',
    file: 'src/pages/SeesArenaPage.jsx',
    css: 'src/pages/sees-arena.css',
    api: ['POST /api/scoring/arena/consensus'],
  },
  // Canonical URL — part of gradual /scoring/ → /protocols/ migration
  '/protocols/protocols-registry': {
    tier: 'premium',
    review: 'approved',
    label: 'Protocols Registry',
    file: 'src/pages/ProtocolsPage.jsx',
    css: 'src/pages/protocols.css',
    api: ['GET /api/scoring/gated/protocols', 'GET /api/scoring/protocols'],
  },
  '/protocols/protocol-trail': {
    tier: 'premium',
    review: 'approved',
    label: 'Protocol Trail',
    file: 'src/pages/ProtocolTrailPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/scoring/runs'],
  },
  '/scoring/singles-monitor': {
    tier: 'premium',
    review: 'approved',
    label: 'Singles Monitor',
    file: 'src/pages/SinglesMonitorPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/scoring/breakdown/:symbol', 'GET /api/automation/status'],
  },
  // MOVED from /automation/speed-scanner 2026-10-02 — the Automation area was retired and the owner
  // asked for this page "to the Trading area". The ROUTE changed with the area, because a route's
  // first segment names where the view lives.
  '/trading/speed-scanner': {
    tier: 'premium',
    review: 'approved',
    label: 'Speed Scanner',
    file: 'src/pages/SpeedScannerPage.jsx',
    css: 'src/pages/speed-scanner.css',
    api: ['POST /api/speed/scan'],
  },
  // Moved out of the deleted /automation/execution-queue page, 2026-10-02 (owner direction:
  // "Preserve them and put the Protocol Queue somewhere in the Protocol area and Schedule Jobs in
  // the Status area"). `tier` mirrors the page they came from, so the free edition is unchanged.
  // `review: 'pending'` is the honest value — neither has been looked at since the move, so they
  // appear in the Page Walkthrough as unreviewed rather than claiming an approval nobody gave.
  '/protocols/protocol-queue': {
    tier: 'free',
    review: 'pending',
    label: 'Protocol Queue',
    file: 'src/pages/ProtocolQueuePage.jsx',
    css: 'src/pages/queue-ui.css',
    api: ['GET /api/automation/queue', 'POST /api/automation/queue/:id/cancel'],
  },
  '/status/scheduled-jobs': {
    tier: 'free',
    review: 'pending',
    label: 'Scheduled Jobs',
    file: 'src/pages/ScheduledJobsPage.jsx',
    css: 'src/pages/queue-ui.css',
    api: ['GET /api/automation/jobs', 'GET /api/automation/jobs/stats'],
  },
  '/watchlists/active-symbols': {
    tier: 'free',
    review: 'approved',
    label: 'Active Symbols',
    file: 'src/pages/ActiveSymbolsPage.jsx',
    css: 'src/pages/trading-platforms.css',
    api: ['GET /api/symbols', 'GET /api/portfolio', 'GET /api/directives'],
  },
  '/watchlists/user-watchlists': {
    tier: 'free',
    review: 'approved',
    label: 'Watchlists',
    file: 'src/pages/UserWatchlistsPage.jsx',
    css: 'src/pages/watchlists.css',
    api: ['GET /api/watchlists', 'POST /api/watchlists'],
  },
  '/development/qa-testing': {
    tier: 'premium',
    review: 'approved',
    label: 'QA Testing',
    // ⚠️ Case matters to any Linux/CI tooling: the file on disk is `QATestingPage.jsx`, not
    // `QaTestingPage.jsx`. A path that resolves on Windows can fail on a case-sensitive filesystem.
    file: 'src/pages/QATestingPage.jsx',
    css: 'src/pages/qa-testing.css',
    api: [],
  },
  '/status/capability-map': {
    tier: 'premium',
    review: 'approved',
    label: 'Capability Map',
    file: 'src/pages/CapabilityMapPage.jsx',
    css: 'src/pages/capability-map.css',
    api: ['GET /api/capabilities', 'GET /api/directives', 'GET /api/providers/health'],
  },
  '/status/health-check': {
    tier: 'premium',
    review: 'approved',
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
  // MOVED to the Development area 2026-10-02 (owner, Page Walkthrough). The route follows the area,
  // because `/:area/:view` IS the URL — the two files move together or the coverage sweep goes red.
  '/development/commands': {
    tier: 'premium',
    review: 'approved',
    label: 'Commands Reference',
    file: 'src/pages/CommandsReferencePage.jsx',
    css: 'src/pages/commands-reference.css',
    api: [],
  },
  '/builder/architecture-framework': {
    tier: 'premium',
    review: 'approved',
    label: 'Architecture Framework',
    file: 'src/pages/ArchitectureFrameworkPage.jsx',
    css: 'src/pages/architecture-framework.css',
    api: ['GET /api/architecture/index', 'GET /api/architecture/section/:key'],
  },
  '/development/blocked-signals': {
    tier: 'premium',
    // 'pending' until the owner has actually looked at it — the skill is explicit that this
    // becomes 'approved' when they have, and claiming otherwise would be a claim without an
    // observation behind it.
    review: 'pending',
    label: 'Blocked Signals',
    file: 'src/pages/BlockedSignalsPage.jsx',
    css: 'src/pages/blocked-signals.css',
    api: ['GET /api/automation/pre-trade-blocks'],
  },
  '/development/performance-change': {
    tier: 'premium',
    // 'pending' until the owner has actually looked at it. Claiming 'approved' here would be a
    // claim with no observation behind it — the skill is explicit that this flips only after the
    // owner has seen the page.
    review: 'pending',
    label: 'Performance Change',
    file: 'src/pages/PerformanceChangePage.jsx',
    css: 'src/pages/performance-change.css',
    // ⚠️ Both are DB READS, verified against their services rather than assumed from the name:
    //   trade-history       → TradeRecorderService.getHistory()  (a `trade` read)
    //   portfolio-snapshots → prisma.portfolioSnapshot.findMany() (a stored series)
    // Several GETs under /api/scoring RECOMPUTE on call and are deliberately not used here.
    api: ['GET /api/trading/trade-history', 'GET /api/trading/portfolio-snapshots'],
  },
  '/development/ui-review': {
    tier: 'premium',
    // 'pending' until the owner has actually looked at it — the rule this repo applies to every new
    // page (#988). `tier` is metadata only since the free edition was cancelled (2026-10-28); it no
    // longer hides or ships anything, and nothing branches on it.
    review: 'pending',
    label: 'Page Walkthrough',
    file: 'src/pages/UiReviewPage.jsx',
    css: 'src/pages/ui-review.css',
    api: ['GET /api/system/settings/ui-review', 'PUT /api/system/settings/ui-review'],
  },
  // ⚠️ '/development/theme-lab' WAS HERE AND IS DELETED (2026-10-13, owner request). View: Theme Lab
  // is retired; its sections are now the Appearance element groups, and the route redirects to
  // /appearance/layout-guide. The shared stylesheet it was written against — src/pages/theme-lab.css —
  // DID NOT MOVE: it is still what `.tl-section`, `.tl-hint` and friends are defined in, and the
  // Appearance group pages import it. If it is ever renamed, those imports must follow, or every
  // example renders unstyled (a failure that looks like broken components, not a missing stylesheet).
  // A stale row here is not harmless: scripts/verify-view-meta-routes.cjs compares view-meta against
  // the live routes, and nav renders from the same list.
  // ⚠️ '/status/meta-stack-pipeline' WAS HERE AND IS DELETED (2026-10-08, owner direction).
  // Its board is now a SECTION of /development/pipeline-graph-lab, so there is no page to describe.
  // A stale row here is not harmless: scripts/verify-view-meta-routes.cjs compares view-meta against
  // the live routes, and nav renders from the same list.
  '/settings/settings-database': {
    tier: 'premium',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Trading Plans',
    file: 'src/pages/TradingPlansPage.jsx',
    css: 'src/pages/trading-plans-page.css',
    api: [],
  },
  '/trading/strategy-library': {
    tier: 'premium',
    review: 'approved',
    label: 'Strategy Library',
    file: 'src/pages/StrategyLibraryPage.jsx',
    css: 'src/pages/strategy-library.css',
    api: [],
  },
  '/trading/performance-lab': {
    tier: 'free',
    review: 'approved',
    label: 'Trading Performance',
    file: 'src/pages/PerformanceLabPage.jsx',
    css: 'src/pages/performance-lab.css',
    api: [],
  },
  '/trading/trading-settings': {
    tier: 'free',
    review: 'approved',
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
  // MOVED to the Status area 2026-10-02 (owner, Page Walkthrough).
  '/status/order-testing': {
    tier: 'premium',
    review: 'approved',
    label: 'Order Testing',
    file: 'src/pages/OrderTestingPage.jsx',
    css: 'src/pages/order-test.css',
    api: [],
  },
  '/trading212/t212-portfolio': {
    tier: 'free',
    review: 'approved',
    label: 'Portfolio',
    file: 'src/pages/T212PortfolioPage.jsx',
    css: 'src/pages/t212-portfolio.css',
    api: [],
  },
  '/trading212/t212-isa': {
    tier: 'free',
    review: 'approved',
    label: 'Stocks ISA',
    file: 'src/pages/T212ISAPage.jsx',
    css: 'src/pages/t212-isa.css',
    api: [],
  },


  // ── Scoring ──
  '/scoring/live-ordering-stack': {
    tier: 'premium',
    review: 'approved',
    label: 'Ladder',
    file: 'src/pages/LadderPage.jsx',
    css: 'src/pages/ladder.css',
    api: [],
  },
  '/scoring/ab-ladder': {
    tier: 'premium',
    review: 'approved',
    label: 'A/B Ladder',
    file: 'src/pages/AbLadderPage.jsx',
    css: 'src/pages/ab-ladder.css',
    api: [],
  },
  '/scoring/scoring-activity-logs': {
    tier: 'premium',
    review: 'approved',
    label: 'Scoring Activity Logs',
    file: 'src/pages/ScoringActivityLogsPage.jsx',
    css: 'src/pages/scoring-activity-logs.css',
    api: [],
  },
  '/signals/signals-overview': {
    tier: 'premium',
    review: 'approved',
    label: 'Signals',
    file: 'src/pages/SignalsOverviewPage.jsx',
    css: 'src/pages/signals-overview.css',
    api: [],
  },

  // ── Automation (already covered above) ──

  '/lab/backtest': {
    tier: 'premium',
    review: 'approved',
    label: 'Backtesting Protocols',
    file: 'src/pages/BacktestProtocolsPage.jsx',
    css: 'src/pages/backtest-lab.css',
    api: [
      'POST /api/backtest/run',
      'GET /api/backtest/results/:runId',
      'GET /api/backtest/equity/:runId',
      'POST /api/backtest/runs/compare',
      'GET /api/backtest/settings-inventory',
      'POST /api/replay/run',
      'GET /api/scoring/gated/protocols',
      'GET /api/backtest/periods',
    ],
  },
  /**
   * ⚠️ ADDED 2026-10-26 — the STRATEGIES half of the Lab split (owner direction: *"Lets separate
   * them. Split … into two pages."*). It shares `BacktestPage.jsx` with the protocols route, so
   * `file` names the shared implementation and `entry` names the wrapper that fixes the subject.
   *
   * ⚠️ `verify-view-meta-routes.cjs` FAILED on the first run after the nav entry was added:
   * `MISSING METADATA /lab/backtest-strategies`. That is the gate doing its job — a page reachable
   * by URL but undocumented renders "No metadata registered".
   */
  '/lab/backtest-strategies': {
    tier: 'premium',
    review: 'needs-review',
    label: 'Backtest Strategies',
    file: 'src/pages/BacktestPage.jsx',
    entry: 'src/pages/BacktestStrategiesPage.jsx',
    css: 'src/pages/backtest-lab.css',
    api: [
      'POST /api/backtest/run',
      'GET /api/backtest/results/:runId',
      'GET /api/backtest/equity/:runId',
      'POST /api/backtest/runs/compare',
      'GET /api/backtest/settings-inventory',
      'GET /api/backtest/periods',
      'GET /api/trading/strategies',
      'GET /api/trading/bot-performance',
      'GET /api/system/logs/file',
    ],
  },
  // ⚠️ ADDED 2026-10-31. "Completed runs" moved off `/lab/backtest-strategies` onto its own page
  // (owner direction — the strategies page had eleven steps and four tabs). It reads and compares
  // stored runs and nothing else, so its API list is deliberately short: `runs`, `runs/compare` and
  // the per-run delete. It does NOT run a backtest and must not be given the run endpoints.
  '/lab/backtest-runs': {
    tier: 'premium',
    review: 'pending',
    label: 'Completed Runs',
    file: 'src/pages/BacktestRunsPage.jsx',
    css: 'src/pages/BacktestRunsPage.css',
    api: [
      'GET /api/backtest/runs',
      'POST /api/backtest/runs/compare',
      'DELETE /api/backtest/runs/:runId',
    ],
  },
  // ⚠️ `'protocol-backtest'` RETIRED 2026-10-22 (#1134). The page was merged into `/lab/backtest` —
  // the protocol surface is now the "Protocols" subject toggle there, and its score table is the
  // `ProtocolScoreDetail` drill-down. `verify-view-meta-routes.cjs` fails if an entry outlives its
  // route, which is exactly what caught this one needing removal rather than a label tweak.
  // ⚠️ ADDED 2026-10-17. `verify-view-meta-routes.cjs` found this leaf registered in `nav-tree.js`
  // with no metadata, so the page rendered "No metadata registered" — reachable but undocumented.
  // The nav entry was added for #823 Stage 1 without this half; the sweep is what caught it.
  '/lab/backtest-data': {
    tier: 'premium',
    review: 'pending',
    label: 'Backtest Data',
    file: 'src/pages/BacktestDataPage.jsx',
    css: 'src/pages/backtest-data.css',
    api: [
      'GET /api/backtest/data-inventory',
      'GET /api/speed/record/active',
      // ⚠️ MOVED HERE 2026-10-22 (#1136): the captured-windows panel was on /lab/backtest. A period is
      // DATA — a named, imported window of bars — so it is managed on the page that inventories data,
      // and the Lab only consumes it.
      'GET /api/backtest/periods',
      'POST /api/backtest/periods',
      'POST /api/backtest/periods/:id/import',
      'DELETE /api/backtest/periods/:id',
    ],
  },
  '/education/candle-patterns': {
    tier: 'free',
    review: 'approved',
    label: 'Pattern Detection',
    file: 'src/pages/TrainingCandlePatternsPage.jsx',
    css: 'src/pages/training-candle-patterns-page.css',
    api: [],
  },
  '/education/candle-patterns-guide': {
    tier: 'free',
    review: 'approved',
    label: 'Candle Patterns',
    file: 'src/pages/CandlePatternsGuidePage.jsx',
    css: 'src/pages/candle-patterns-guide.css',
    api: [],
  },

  // ── Status ──
  '/status/setup': {
    tier: 'free',
    review: 'approved',
    label: 'Setup & Diagnostics',
    file: 'src/pages/SetupWizardPage.jsx',
    css: 'src/pages/setup-wizard.css',
    api: [],
  },
  '/status/system-log': {
    tier: 'premium',
    review: 'approved',
    label: 'System Log',
    file: 'src/pages/SystemLogPage.jsx',
    css: 'src/pages/system-log.css',
    api: [],
  },
  '/status/platform-comparisons': {
    // `tier` is metadata, not a build switch. It used to drive two code generators that emitted a
    // filtered "free edition" bundle (scripts/generate-free-manifest.cjs / generate-free-map.cjs);
    // both were deleted with the free edition on 2026-10-28 (SETTLED-DECISIONS row 96). It is kept
    // because it is the field a future member tier would read — nothing branches on it today.
    tier: 'free',
    review: 'approved',
    label: 'API Comparisons',
    file: 'src/pages/PlatformComparisonsPage.jsx',
    css: 'src/pages/platform-comparisons.css',
    api: [],
  },
  '/status/meta-stack-status': {
    tier: 'premium',
    review: 'approved',
    label: 'META.Stack Status',
    file: 'src/pages/MetaStackStatusPage.jsx',
    css: 'src/pages/meta-stack-status.css',
    api: [],
  },
  // MOVED to the Development area 2026-10-02 (owner, Page Walkthrough) — engineering reference.
  '/development/file-inventory': {
    tier: 'premium',
    review: 'approved',
    label: 'File Inventory',
    file: 'src/pages/FileInventoryPage.jsx',
    css: 'src/pages/file-inventory-page.css',
    api: [],
  },

  '/trading/mt5-trading': {
    tier: 'free',
    review: 'approved',
    label: 'Manual Trading',
    file: 'src/pages/Mt5TradingPage.jsx',
    css: 'src/pages/mt5-trading-page.css',
    api: [],
  },
  '/development/strategy-wizard': {
    tier: 'premium',
    review: 'approved',
    label: 'Strategy Wizard',
    file: 'src/pages/StrategyWizardPage.jsx',
    css: 'src/pages/strategy-wizard.css',
    api: [],
  },
  '/development/diagrams': {
    tier: 'premium',
    review: 'approved',
    label: 'Diagrams',
    file: 'src/pages/DiagramsPage.jsx',
    css: 'src/pages/diagrams.css',
    api: [],
  },
  '/status/meta-stack-explorer': {
    tier: 'premium',
    review: 'approved',
    label: 'META.Stack Explorer',
    file: 'src/pages/MetaStackExplorerPage.jsx',
    css: 'src/pages/meta-stack-explorer.css',
    api: [],
  },
  // Identity Map — TEMPORARY diagnostic (see IdentityMapLabPage.jsx). Data is a SNAPSHOT in
  // src/data/identity-map.json, rebuilt by `node nest/scripts/identity-map.cjs`. `api: []` is
  // accurate: the page makes no live call, so it cannot go stale against a dead backend —
  // but it CAN go stale against a schema change. Re-run the script after schema edits.
  '/development/identity-map': {
    tier: 'premium',
    review: 'approved',
    label: 'Identity Map',
    file: 'src/pages/IdentityMapLabPage.jsx',
    css: 'src/pages/identity-map-lab.module.css',
    api: [],
  },
  // MOVED to Settings 2026-10-02 (owner, Page Walkthrough) — a per-machine preference.
  '/appearance/screen-assignment': {
    tier: 'premium',
    review: 'approved',
    label: 'Screen Assignment',
    file: 'src/pages/ScreenCockpitPage.jsx',
    css: 'src/pages/screen-cockpit.css',
    api: [],
  },
  '/appearance/responsive-layout-lab': {
    tier: 'premium',
    review: 'approved',
    label: 'Responsive Layout Lab',
    file: 'src/pages/ResponsiveLayoutLabPage.jsx',
    css: 'src/pages/responsive-layout-lab.css',
    api: [],
  },
  '/lab/charts-lab': {
    tier: 'premium',
    review: 'approved',
    label: 'Charts Lab',
    file: 'src/pages/ChartsLabPage.jsx',
    css: 'src/pages/charts-lab.css',
    api: [],
  },
  '/development/pipeline-graph-lab': {
    tier: 'premium',
    review: 'approved',
    label: 'Pipeline Graph',
    file: 'src/pages/PipelineGraphLabPage.jsx',
    css: 'src/pages/pipeline-graph-lab.css',
    api: [],
  },
  '/development/feature-lab': {
    tier: 'premium',
    review: 'approved',
    label: 'Feature Lab',
    file: 'src/pages/FeatureLabPage.jsx',
    css: 'src/pages/feature-lab.css',
    api: [],
  },
  '/lab/snapshot-replay': {
    tier: 'premium',
    review: 'approved',
    label: 'Snapshot Replay',
    file: 'src/pages/SnapshotReplayPage.jsx',
    css: 'src/pages/snapshot-replay.css',
    api: [],
  },
  '/development/meta-stack-cockpit': {
    tier: 'premium',
    review: 'approved',
    label: 'META.Stack Cockpit',
    file: 'src/pages/MetaStackCockpitPage.jsx',
    css: 'src/pages/metastack-cockpit.css',
    api: [],
  },
  // MOVED to the Research area 2026-10-02 (owner, Page Walkthrough).
  '/research/daily-briefing': {
    tier: 'premium',
    review: 'approved',
    label: 'Daily Briefing',
    file: 'src/pages/DailyBriefingPage.jsx',
    css: 'src/pages/daily-briefing.css',
    api: [],
  },
  '/lab/snapshots': {
    tier: 'premium',
    review: 'approved',
    label: 'Snapshots',
    file: 'src/pages/SnapshotLibraryPage.jsx',
    css: 'src/pages/snapshot-library.css',
    api: [],
  },

  // ── Development ──
  '/development/roadmap': {
    tier: 'premium',
    review: 'approved',
    label: 'Dynamic Roadmap',
    file: 'src/pages/RoadmapPage.jsx',
    css: 'src/pages/roadmap-page.css',
    api: ['GET /api/roadmap'],
  },
  // #944 — the theory registry. Static data, no API: the file is the source of truth and
  // `scripts/validate-theories.cjs` is its guard.
  '/development/theory-registry': {
    tier: 'premium',
    review: 'approved',
    label: 'Theory Registry',
    file: 'src/pages/TheoryRegistryPage.jsx',
    css: 'src/pages/theory-registry.css',
    api: [],
  },
  // R21 / #990 — the design observation register. Static data with an ON-DEMAND guard
  // (`scripts/validate-design-observations.cjs`), the same shape and the same reasoning as the
  // theory registry above: the file is the source of truth, so there is no API to declare.
  '/development/design-observations': {
    tier: 'premium',
    review: 'pending',
    label: 'Design Observations',
    file: 'src/pages/DesignObservationsPage.jsx',
    css: 'src/pages/design-observations.css',
    api: [],
  },
  '/planner/personal-finances': {
    // ⚠️ FREE as of 2026-10-02 (owner: "Change this to a free page. I would like to offer some basic
    // finance management between..."). Was premium.
    tier: 'free',
    review: 'approved',
    label: 'Personal Finances',
    file: 'src/pages/PersonalFinancesPage.jsx',
    css: 'src/pages/personal-finances.css',
    api: [],
  },
  '/planner/trading-styles': {
    // ⚠️ FREE as of 2026-10-02 (owner: "Change this to a free page. It's a way to dynamically change
    // the app and that will need..."). Was premium.
    tier: 'free',
    review: 'approved',
    label: 'Trading Styles',
    file: 'src/pages/TradingStylesPage.jsx',
    css: 'src/pages/trading-styles.css',
    api: [],
  },
  '/planner/objectives': {
    // ⚠️ FREE as of 2026-10-02 (owner: "Change this to a free page"). Was premium.
    // ⚠️ The second half — "Add Education to <select.ob-select>" — is NOT done; it is a control
    // change on the page, not a tier change.
    tier: 'free',
    review: 'approved',
    label: 'Objectives',
    file: 'src/pages/ObjectivesPage.jsx',
    css: 'src/pages/objectives.css',
    api: [],
  },

  // ── Settings ──
  '/settings/monitoring': {
    tier: 'premium',
    review: 'approved',
    label: 'Monitoring',
    file: 'src/pages/MonitoringPage.jsx',
    css: 'src/pages/settings.css',
    api: ['GET /api/alerts/count', 'GET /api/alerts/settings'],
  },
  '/settings/risk-controls': {
    tier: 'free',
    review: 'approved',
    label: 'Risk Controls',
    file: 'src/pages/RiskControlsPage.jsx',
    css: 'src/pages/risk-controls.css',
    api: [],
  },
  '/settings/settings': {
    tier: 'free',
    review: 'approved',
    label: 'General',
    file: 'src/pages/SettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: ['GET /api/system/settings/health-checks', 'PUT /api/system/settings/health-checks'],
  },
  '/settings/settings-education': {
    tier: 'free',
    review: 'approved',
    label: 'Education',
    file: 'src/pages/SettingsEducationPage.jsx',
    css: 'src/pages/settings-education.css',
    api: [],
  },
  // Appearance area — NEW 2026-10-13 (owner request). One entry per view the area will host; the
  // moved pages (Appearance, Screen Assignment, Responsive Layout Lab, Motion, Forms) land beside it.
  // ⚠️ `tier` is REQUIRED and must be exactly 'free' or 'premium' — `scripts/generate-free-manifest.cjs`
  // throws on anything else, which is how it caught this entry declaring "pro". The manifest is an
  // ALLOW-LIST, so a page that omits a tier cannot leak into the free edition; it fails the generator
  // instead. Set to 'premium': this is the advanced visual-options surface, not a free-edition view.
  '/appearance/layout-guide': {
    label: 'Layout Guide',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceAreaPage.jsx',
    api: [],
    review: 'pending',
  },
  // Pattern Library — 2026-10-13. A static reading of the Page Walkthrough verdicts, so it fetches
  // nothing and works with the API down.
  '/appearance/patterns': {
    label: 'Pattern Library',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearancePatternsPage.jsx',
    api: [],
    review: 'pending',
  },
  // Motion and Forms — new 2026-10-13. Both are MOVES rather than new work: their sections were
  // composed into Theme Lab and are now pages of their own in the Appearance area (owner request).
  // No API — they render live app components and form controls, and fetch nothing.
  // Information — 2026-10-30. The ONE reference for how a sentence is displayed (see InfoNote.jsx).
  // Renders the app's own component, so it cannot drift from the pages that use it. Fetches nothing.
  '/appearance/info': {
    label: 'Information',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceInfoPage.jsx',
    api: [],
    review: 'pending',
  },
  '/appearance/motion': {
    label: 'Motion',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceMotionPage.jsx',
    api: [],
    review: 'pending',
  },
  '/appearance/forms': {
    label: 'Forms',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceFormsPage.jsx',
    api: [],
    review: 'pending',
  },
  // Element groups — 2026-10-13. The four pages below carry the sections that used to make up
  // View: Theme Lab, split by what a reader is trying to decide (colour, container, table, control).
  // No API — they render static examples against the active theme tokens.
  '/appearance/colour': {
    label: 'Colour',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceColourPage.jsx',
    api: [],
    review: 'pending',
  },
  '/appearance/surfaces': {
    label: 'Surfaces & Cards',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceSurfacesPage.jsx',
    api: [],
    review: 'pending',
  },
  '/appearance/data-display': {
    label: 'Data Display',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceDataDisplayPage.jsx',
    api: [],
    review: 'pending',
  },
  '/appearance/interactive': {
    label: 'Interactive',
    area: 'appearance',
    tier: 'premium',
    file: 'src/pages/AppearanceInteractivePage.jsx',
    api: [],
    review: 'pending',
  },
  // ⚠️ '/settings/theme-packs' REMOVED 2026-10-13 (owner request). Its gallery duplicated the
  // shell rail's pack controls and the new Appearance area's chooser — three surfaces for one setting.

  '/settings/user-preferences': {
    tier: 'free',
    review: 'approved',
    label: 'User Preferences',
    file: 'src/pages/PreferenceLab.jsx',
    css: 'src/pages/preference-lab.css',
    api: [],
  },
  '/settings/trading-settings': {
    tier: 'free',
    review: 'approved',
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
  '/appearance/appearance': {
    tier: 'free',
    review: 'approved',
    label: 'Appearance',
    file: 'src/pages/AppearanceSettingsPage.jsx',
    css: 'src/pages/settings.css',
    api: [],
  },
  '/settings/scoring-settings': {
    tier: 'premium',
    review: 'approved',
    label: 'Scoring Settings',
    file: 'src/pages/ScoringSettingsPage.jsx',
    css: 'src/pages/settings.css',
    // ⚠️ `reachable-capacity` is ON DEMAND (`enabled: false` until the reader clicks Measure).
    // It is listed here because the page can call it, not because it loads with the page — it
    // costs ~500 ms and is deliberately not paid on every visit.
    api: [
      'GET /api/scoring/gated/thresholds',
      'GET /api/scoring/gated/reachable-capacity',
      'POST /api/automation/layer',
    ],
  },
  '/settings/automation': {
    tier: 'premium',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/home-dashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
  },
  '/dashboard/screen': {
    tier: 'premium',
    review: 'pending',
    label: 'Screen View',
    file: 'src/pages/ScreenBoardPage.jsx',
    css: 'src/components/widget-board.css',
    api: [],
  },


  // ── REGISTERED 2026-09-22 — the NAV-LEAF METADATA GAP ─────────────────────────────────────────
  // Every sidebar link resolves to `/area/viewId` and the Dev Overlay reports "No metadata
  // registered for this route" when the lookup misses. Measured 2026-09-22 (after the owner hit
  // /trading/strategies-derived): 14 of 125 nav leaves had NO entry — this block registers them
  // all, and `scripts/verify-view-meta-routes.cjs` now ENFORCES coverage, so the next nav link
  // added without metadata fails the verifier instead of landing on the user.
  '/research/research-notes': {
    tier: 'free',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Events Calendar',
    file: 'src/pages/EventsCalendarPage.jsx',
    css: 'src/pages/events-calendar.css',
    api: [
      'GET /api/research/earnings/calendar',
      'GET /api/automation/risk-events?lookahead=240',
      'GET /api/portfolio',
    ],
  },
  '/research/stock-investigation': {
    tier: 'premium',
    review: 'approved',
    label: 'Stock Investigation',
    file: 'src/pages/StockInvestigationPage.jsx',
    css: 'src/pages/stock-investigation.css',
    api: ['GET /api/research/investigations?limit=30', 'POST /api/research/investigations'],
  },
  '/research/market-correlations': {
    tier: 'free',
    review: 'approved',
    label: 'Market Correlations',
    file: 'src/pages/MarketCorrelationsPage.jsx',
    css: 'src/pages/market-correlations.css',
    api: ['GET /api/portfolio/correlation'],
  },
  '/research/recently-analysed-symbols': {
    tier: 'free',
    review: 'approved',
    label: 'Recently Analysed',
    file: 'src/pages/RecentlyAnalysedSymbolsPage.jsx',
    css: 'src/pages/recently-analysed.css',
    api: ['GET /api/scoring/recently-analysed?limit=50'],
  },
  '/research/analyse-symbol': {
    tier: 'premium',
    review: 'approved',
    label: 'Analyse Symbol',
    file: 'src/pages/AnalyseSymbolPage.jsx',
    css: 'src/pages/analyse-symbol.css',
    api: ['GET /api/symbols', 'GET /api/scoring/ranked?limit=50'],
  },
  '/protocols/protocol-builder': {
    tier: 'premium',
    review: 'approved',
    label: 'Protocol Builder',
    file: 'src/pages/CreateProtocolsPage.jsx',
    css: 'src/pages/create-protocols.css',
    api: ['GET /api/directives', 'GET /api/scoring/protocols', 'POST /api/scoring/protocols'],
  },
  '/protocols/directive-viewer': {
    tier: 'premium',
    review: 'approved',
    label: 'Directive Viewer',
    file: 'src/pages/DirectiveViewerPage.jsx',
    css: 'src/pages/directive-viewer.css',
    api: ['GET /api/directives/:id/viewer'],
  },
  '/protocols/dual-protocol-inspector': {
    tier: 'premium',
    review: 'approved',
    // The nav label is "Dual-Protocol Inspector"; the component file keeps its lab name.
    label: 'Dual-Protocol Inspector',
    file: 'src/pages/ScoringDebugLab.jsx',
    css: 'src/pages/scoring-debug-lab.css',
    api: ['GET /api/scoring/gated/:symbol?protocol&bars&timeframe'],
  },
  '/trading/strategies-derived': {
    tier: 'premium',
    review: 'approved',
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
    tier: 'free',
    review: 'approved',
    label: 'Education Settings',
    file: 'src/pages/SettingsEducationPage.jsx',
    css: 'src/pages/settings.css',
    api: [],
  },
  '/development/architecture-framework': {
    tier: 'premium',
    review: 'approved',
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
  '/lab/position-lifecycle': {
    tier: 'premium',
    review: 'approved',
    label: 'Position Lifecycle',
    file: 'src/pages/PositionLifecyclePage.jsx',
    css: 'src/pages/position-lifecycle.css',
    api: ['GET /api/trading/position-lifecycle'],
  },
};

/** Resolve a URL path to the VIEW_META KEY (exact, then longest-prefix match), or null. */
export function getViewMetaKey(pathname) {
  // Try exact match first
  if (VIEW_META[pathname]) return pathname;

  // Try prefix match for sub-routes (e.g. /trading/strategy/123 → /trading/strategy)
  // Sort by route length descending so longer (more specific) routes match first
  const routes = Object.keys(VIEW_META).sort((a, b) => b.length - a.length);
  for (const route of routes) {
    if (pathname.startsWith(route + '/')) return route;
  }

  return null;
}

/** Get view metadata from current URL path */
export function getViewMeta(pathname) {
  const key = getViewMetaKey(pathname);
  return key ? VIEW_META[key] : null;
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
