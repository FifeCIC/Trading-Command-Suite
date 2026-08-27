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
  '/trading/strategy-comparison': {
    label: 'Trading Strategy Comparison',
    file: 'src/pages/StrategyComparisonPage.jsx',
    css: 'src/pages/strategy-comparison.css',
    api: ['GET /api/trading/strategy-comparison'],
  },
  '/trading/strategy-monitor': {
    label: 'Strategy Monitor',
    file: 'src/pages/StrategyMonitorPage.jsx',
    css: 'src/pages/strategy-monitor.css',
    api: ['GET /api/trading/strategies/with-ratios', 'GET /api/automation/status', 'GET /api/trading/strategy-comparison', 'GET /api/scoring/arena'],
  },
  '/trading/strategy-create': {
    label: 'Create Strategy',
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
  '/qa/qa-testing': {
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
    api: ['GET /api/system/health-dashboard', 'GET /api/system/health-check'],
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
  '/lab/triple-screen': {
    label: 'Triple-Screen Cockpit',
    file: 'src/pages/TripleScreenPage.jsx',
    css: 'src/pages/triple-screen.css',
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

  // ── Planner ──
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
    api: [],
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

  // ── Dashboard ──
  '/dashboard/dashboard': {
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/home-dashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
  },

  // ── Watchlists ──
  '/watchlists/add-symbol': {
    label: 'Add Symbol',
    file: 'src/pages/AddSymbolPage.jsx',
    css: 'src/pages/add-symbol.css',
    api: [],
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
