/**
 * Navigation Tree — Single source of truth for the shell layout.
 *
 * Areas map to footer/quick-menu primary items.
 * Each area's `views` array drives the left sidebar.
 *
 * Mapped from the WordPress Trader.CORE plugin page/tab structure:
 *   - trading   → Trading page (SEES tabs, strategies, portfolio)
 *   - scoring   → Scoring Directives page (directives, algorithm, strategies)
 *   - research  → Research page + Symbols + Analysis
 *   - data      → Data page (sources, tables, import, API activity)
 *   - automation→ Automation page (execution queue, CRON, data import)
 *   - builder   → Development page (architecture, theme, components, runtime)
 *   - ops       → Settings/Setup/Status operational views
 *   - settings  → Settings page (general, database, features)
 */

export const NAV_TREE = {
  trading: {
    label: 'Trading',
    views: [
      { id: 'trading-strategies', label: 'Trading Strategies' },
      { id: 'mt5-status', label: 'MT5 Bridge Status' },
      { id: 'mt5-trading', label: 'MT5 Trading' },
      { id: 'calculators', label: 'Calculators' },
      { id: 'portfolio-overview', label: 'Portfolio Overview' },
      { id: 'trade-history', label: 'Trade History' },
      { id: 'manual-trading', label: 'Manual Trading' },
      { id: 'positions-monitor', label: 'Positions Monitor' },
      { id: 'trade-journal', label: 'Trade Journal' },
    ],
  },
  scoring: {
    label: 'Scoring',
    views: [
      // ── Directives ──
      { id: 'directives-manager', label: 'Directives' },
      { id: 'scoring-overview', label: 'Overview' },
      { id: 'configure-directives', label: 'Configure Directives' },
      { id: 'directives-status', label: 'Directive Status' },
      // ── SEES — Scoring Engine ──
      { id: 'algorithm-lab', label: 'Algorithm Lab' },
      { id: 'sees-live-stack', label: 'SEES Live Stack' },
      { id: 'sees-arena', label: 'SEES Arena' },
      { id: 'signals-workbench', label: 'SEES Diagnostics' },
      // ── Strategies ──
      { id: 'strategy-builder', label: 'Strategy Builder' },
      { id: 'strategies', label: 'Strategy Overview' },
      { id: 'create-scoring-strategies', label: 'Create Strategies' },
      { id: 'manage-scoring-strategies', label: 'Manage Strategies' },
      { id: 'view-scoring-strategies', label: 'View Strategies' },
      // ── History ──
      { id: 'scoring-runs', label: 'Scoring Runs' },
      { id: 'scoring-activity-logs', label: 'Scoring Activity Logs' },
    ],
  },
  research: {
    label: 'Research',
    views: [
      { id: 'research-overview', label: 'Overview' },
      { id: 'symbols-browser', label: 'Symbols' },
      { id: 'sector-rotation', label: 'Sector Rotation' },
      { id: 'market-correlations', label: 'Market Correlations' },
      { id: 'technical-indicators', label: 'Technical Indicators' },
      { id: 'news-intel', label: 'News Intel' },
      { id: 'earnings-calendar', label: 'Earnings Calendar' },
      { id: 'social-networks', label: 'Social Networks' },
      { id: 'price-forecast', label: 'Price Forecast' },
      { id: 'events-calendar', label: 'Events Calendar' },
      { id: 'pattern-scanner', label: 'Pattern Scanner' },
      { id: 'macro-monitor', label: 'Macro Monitor' },
    ],
  },
  analysis: {
    label: 'Analysis',
    views: [
      { id: 'recently-analysed-symbols', label: 'Recently Analysed Symbols' },
      { id: 'support-resistance', label: 'Support & Resistance' },
      { id: 'volatility-analysis', label: 'Volatility Analysis' },
    ],
  },
  data: {
    label: 'Data',
    views: [
      { id: 'data-landing', label: 'Data Overview' },
      { id: 'trading-platforms', label: 'Sources' },
      { id: 'import-jobs', label: 'Import Jobs' },
      { id: 'data-elements', label: 'Data Elements' },
      { id: 'manual-import', label: 'Manual Import' },
      { id: 'decoder', label: 'Decoder' },
      { id: 'database-tables', label: 'Tables' },
      { id: 'imports-history', label: 'Imports History' },
      { id: 'api-activity', label: 'API Activity' },
      { id: 'api-endpoints', label: 'API Endpoints' },
      { id: 'transient-caches', label: 'Cache Monitor' },
      { id: 'create-source', label: 'Create Source' },
      { id: 'provider-health', label: 'Provider Health' },
      { id: 'api-keys', label: 'API Keys' },
      { id: 'sources-list', label: 'Sources List' },
      { id: 'api-errors', label: 'API Errors' },
    ],
  },
  watchlists: {
    label: 'Watchlists',
    views: [
      { id: 'active-symbols', label: 'Active Symbols' },
      { id: 'user-watchlists', label: 'User Watchlists' },
      { id: 'create-watchlist', label: 'Create Watchlist' },
    ],
  },
  automation: {
    label: 'Automation',
    views: [
      { id: 'automation-dashboard', label: 'Dashboard' },
      { id: 'background-activity', label: 'Background Activity' },
      { id: 'execution-queue', label: 'Execution Queue' },
      { id: 'automation-rules', label: 'Automation Rules' },
      { id: 'cron-scheduler', label: 'Cron Scheduler' },
      { id: 'alert-center', label: 'Alert Center' },
    ],
  },
  builder: {
    label: 'Development',
    views: [
      { id: 'current-task', label: 'Current Task' },
      { id: 'architecture-framework', label: 'Architecture' },
      { id: 'algorithm-debugger', label: 'Algorithm Debugger' },
      { id: 'diagrams', label: 'Diagrams' },
      { id: 'explore-tasks', label: 'Explore Tasks' },
      { id: 'duplicate-checker', label: 'Duplicate Checker' },
      { id: 'create-task', label: 'Create Task' },
      { id: 'dev-ai', label: 'AI' },
      { id: 'pointers', label: 'Pointers' },
      { id: 'layouts', label: 'Layouts' },
      { id: 'light-ui-library', label: 'Light UI Library' },
      { id: 'dark-ui-library', label: 'Dark UI Library' },
      { id: 'jquery-ui', label: 'jQuery UI' },
      { id: 'assets', label: 'Assets' },
      { id: 'developer-snippets', label: 'Developer Snippets' },
      { id: 'listener-testing', label: 'Listener Testing' },
      { id: 'theme-lab', label: 'Theme Lab' },
      { id: 'component-lab', label: 'Component Lab' },
      { id: 'runtime', label: 'Dev Runtime' },
      { id: 'workflow-wizards', label: 'Workflow Wizards' },
    ],
  },
  focus: {
    label: 'Focus',
    views: [
      { id: 'focus-priority', label: 'Priority' },
      { id: 'focus-daily', label: 'Daily' },
      { id: 'focus-weekly', label: 'Weekly' },
      { id: 'focus-advisor', label: 'Advisor' },
    ],
  },
  platforms: {
    label: 'Trading Platforms',
    views: [
      { id: 'platform-api-management', label: 'API Management' },
      { id: 'platform-api-efficiency', label: 'API Efficiency' },
      { id: 'platform-comparisons', label: 'API Provider Comparisons' },
      { id: 'platform-switches', label: 'Platform Switches' },
    ],
  },
  wizard: {
    label: 'Wizard',
    views: [
      { id: 'setup', label: 'Setup Checklist' },
      { id: 'wizard-sees-readiness', label: 'SEES Readiness' },
    ],
  },
  ops: {
    label: 'Ops',
    views: [
      { id: 'status', label: 'System Status' },
      { id: 'risk-controls', label: 'Risk Controls' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'security', label: 'Security' },
      { id: 'audit-log', label: 'Audit Log' },
    ],
  },
  training: {
    label: 'Training',
    views: [
      { id: 'candle-patterns', label: '🕯️ Candle Patterns' },
    ],
  },
  testing: {
    label: 'Testing',
    views: [
      { id: 'qa-lab', label: 'QA Lab' },
      { id: 'performance-lab', label: 'Performance Lab' },
      { id: 'long-run-tests', label: 'Long-Run Tests' },
      { id: 'backtest', label: 'Backtest Engine' },
    ],
  },
  settings: {
    label: 'Settings',
    views: [
      { id: 'settings', label: 'General' },
      { id: 'settings-trading-api', label: 'Trading API' },
      { id: 'settings-shortcodes', label: 'Shortcodes' },
      { id: 'settings-symbols', label: 'Symbols' },
      { id: 'settings-database', label: 'Database' },
      { id: 'settings-bugnet', label: 'BugNet' },
      { id: 'settings-education', label: 'Education' },
      { id: 'theme-packs', label: 'Theme Packs' },
      { id: 'user-preferences', label: 'User Preferences' },
    ],
  },
};

export const PRIMARY_PAGES = Object.entries(NAV_TREE).map(([id, area]) => ({
  id,
  label: area.label,
}));

/**
 * Quick Menu shortcuts — high-priority jump targets shown in the header dropdown.
 * Each entry must reference a view id that exists somewhere in NAV_TREE.
 */
export const QUICK_MENU = PRIMARY_PAGES;

/**
 * Derive the legacy flat NAV_STRUCTURE shape for backward compat with App.jsx.
 * Returns { [areaKey]: [{ id, label }] }
 */
export function getNavStructure() {
  const structure = {};
  for (const [key, area] of Object.entries(NAV_TREE)) {
    structure[key] = area.views;
  }
  return structure;
}

/**
 * Resolve which area owns a given view id.
 */
export function resolveArea(viewId) {
  for (const [key, area] of Object.entries(NAV_TREE)) {
    if (area.views.some((v) => v.id === viewId)) {
      return key;
    }
  }
  return null;
}
