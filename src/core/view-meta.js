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
  '/lab/scoring-debug-lab': {
    label: 'Scoring Debug (Dual Protocol)',
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
  '/protocols/symbols-ladder': {
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
  '/protocols/protocols-performance': {
    label: 'Protocols Performance',
    file: 'src/pages/ProtocolsPerformancePage.jsx',
    css: 'src/pages/protocols-ladder.css',
    api: ['GET /api/trading/strategies/with-ratios'],
  },
  '/scoring/strategy-ladders': {
    label: 'Strategies Ladder',
    file: 'src/pages/StrategyLaddersPage.jsx',
    css: 'src/pages/sees-arena.css',
    api: ['GET /api/scoring/arena'],
  },
  '/scoring/protocol-builder': {
    label: 'Protocol Builder',
    file: 'src/pages/CreateProtocolsPage.jsx',
    css: 'src/pages/create-protocols.css',
    api: ['GET /api/directives', 'GET /api/watchlists', 'POST /api/scoring/protocols'],
  },
  '/scoring/strategy-builder': {
    label: 'Strategy Builder',
    file: 'src/pages/StrategyBuilderPage.jsx',
    css: 'src/pages/create-protocols.css',
    api: ['GET /api/scoring/protocols', 'POST /api/scoring/strategies'],
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
  '/scoring/directives-manager': {
    label: 'Directives Manager',
    file: 'src/pages/DirectivesManagerPage.jsx',
    css: 'src/pages/directives-manager.css',
    api: ['GET /api/directives'],
  },
  '/scoring/exit-signals': {
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
  '/lab/directive-audit': {
    label: 'Directive Audit',
    file: 'src/pages/DirectiveAuditPage.jsx',
    css: 'src/pages/directive-audit.css',
    api: ['GET /api/backtest/directive-audit'],
  },
  '/protocols/protocol-trail': {
    label: 'Protocol Trail',
    file: 'src/pages/ProtocolTrailPage.jsx',
    css: 'src/pages/decision-trail.css',
    api: ['GET /api/scoring/runs'],
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
