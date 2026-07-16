/**
 * View Metadata — maps URL paths to structured view info.
 * Used by the Dev Overlay's "Copy View Info" button.
 * When adding a new page, add an entry here.
 */

const VIEW_META = {
  '/dashboard': {
    label: 'Dashboard',
    file: 'src/pages/DashboardPage.jsx',
    css: 'src/pages/HomeDashboard.css',
    api: ['GET /api/providers/mt5/diagnostics', 'GET /api/providers/mt5/positions', 'GET /api/scoring/ranked'],
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
  '/trading/create-strategy': {
    label: 'Create Strategy',
    file: 'src/pages/CreateStrategyPage.jsx',
    css: 'src/pages/create-strategy.css',
    api: ['POST /api/trading/strategies', 'GET /api/scoring/gated/protocols', 'GET /api/watchlists'],
  },
  '/trading/strategy-comparison': {
    label: 'Strategy Comparison',
    file: 'src/pages/StrategyComparisonPage.jsx',
    css: 'src/pages/strategy-comparison.css',
    api: ['GET /api/trading/strategy-comparison'],
  },
  '/trading/trade-journal': {
    label: 'Trade Journal',
    file: 'src/pages/TradeJournalPage.jsx',
    css: 'src/pages/TradeJournalPage.css',
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
  '/scoring/directives-manager': {
    label: 'Directives Manager',
    file: 'src/pages/DirectivesManagerPage.jsx',
    css: 'src/pages/directives-manager.css',
    api: ['GET /api/directives'],
  },
  '/scoring/create-protocols': {
    label: 'Create Protocols',
    file: 'src/pages/StrategyBuilderPage.jsx',
    css: 'src/components/StrategyBuilder/strategy-builder.css',
    api: ['GET /api/directives', 'GET /api/watchlists', 'POST /api/strategies'],
  },
  '/scoring/scoring-runs': {
    label: 'Scoring Runs',
    file: 'src/pages/ScoringRunsPage.jsx',
    css: 'src/pages/snapshot-replay.css',
    api: ['GET /api/scoring/runs', 'POST /api/scoring/run'],
  },
  '/scoring/scoring-activity-logs': {
    label: 'Scoring Activity Logs',
    file: 'src/pages/ScoringActivityLogsPage.jsx',
    css: 'src/pages/scoring-activity-logs.css',
    api: ['GET /api/scoring/runs', 'GET /api/signals/envelope/:symbol'],
  },
  '/scoring/scoring-overview': {
    label: 'Scoring Overview',
    file: 'src/pages/ScoringOverviewPage.jsx',
    css: 'src/pages/scoring-overview.css',
    api: ['GET /api/scoring/ranked'],
  },
  '/scoring/exit-signals': {
    label: 'Exit Signals',
    file: 'src/pages/ExitSignalsPage.jsx',
    css: 'src/pages/exit-signals.css',
    api: ['GET /api/portfolio/exit-signals'],
  },
  '/scoring/sees-arena': {
    label: 'SEES Arena',
    file: 'src/pages/SeesArenaPage.jsx',
    css: 'src/pages/sees-arena.css',
    api: ['POST /api/scoring/arena/consensus'],
  },
  '/scoring/protocols': {
    label: 'Protocols',
    file: 'src/pages/ProtocolsPage.jsx',
    css: 'src/pages/protocols.css',
    api: ['GET /api/scoring/protocols'],
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
  '/automation/bot-rules': {
    label: 'Bot Rules',
    file: 'src/pages/AutomationRulesPage.jsx',
    css: 'src/pages/automation-rules.css',
    api: ['GET /api/automation/rules'],
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
  '/builder/architecture-framework': {
    label: 'Architecture Framework',
    file: 'src/pages/ArchitectureFrameworkPage.jsx',
    css: 'src/pages/architecture-framework.css',
    api: ['GET /api/architecture/index', 'GET /api/architecture/section/:key'],
  },
  '/lab/hot-stock-picks': {
    label: 'Hot Stock Picks',
    file: 'src/pages/HotStockPicksPage.jsx',
    css: 'src/pages/HotStockPicksPage.css',
    api: ['GET /api/scoring/ranked'],
  },
  '/lab/theme-lab': {
    label: 'Theme Lab',
    file: 'src/pages/ThemeLabPage.jsx',
    css: 'src/pages/theme-lab.css',
    api: [],
  },
};

/** Get view metadata from current URL path */
export function getViewMeta(pathname) {
  // Try exact match first
  if (VIEW_META[pathname]) return VIEW_META[pathname];

  // Try prefix match for sub-routes
  for (const [route, meta] of Object.entries(VIEW_META)) {
    if (pathname.startsWith(route + '/')) return meta;
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
