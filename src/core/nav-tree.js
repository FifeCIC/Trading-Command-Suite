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
      { id: 'trading-strategies', label: 'Trading Strategies', icon: '◆' },
      { id: 'mt5-trading', label: 'MT5 Trading', icon: '◆' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'portfolio-overview', label: 'Portfolio Overview', icon: '◉' },
      { id: 'trade-history', label: 'Trade History', icon: '◈' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      { id: 'trade-journal', label: 'Trade Journal', icon: '▤' },
      { id: 'backtest', label: 'Backtest Engine', icon: '⬡' },
      { id: 'mt5-connection-manager', label: 'MT5 Accounts', icon: '🔌' },
      { id: 'accounts-dashboard', label: 'Accounts', icon: '💰' },
      { id: 'order-testing', label: 'Order Testing', icon: '🧪' },
    ],
  },
  scoring: {
    label: 'Scoring',
    views: [
      { id: 'directives-manager', label: 'Directives', icon: '◆' },
      { id: 'scoring-overview', label: 'All Directives', icon: '◉' },
      { id: 'configure-directives', label: 'Configure Directives', icon: '⚙' },
      { id: 'directives-status', label: 'Directive Status', icon: '◈' },
      { id: 'algorithm-lab', label: 'Algorithm Log', icon: '▤' },
      { id: 'sees-live-stack', label: 'SEES Live Stack', icon: '◆' },
      { id: 'sees-arena', label: 'SEES Arena', icon: '◆' },
      { id: 'predictive-sees', label: 'Predictive SEES', icon: '🔮' },
      { id: 'signals-workbench', label: 'SEES Diagnostics', icon: '◈' },
      { id: 'protocol-overview', label: 'Protocol Overview', icon: '◉' },
      { id: 'create-protocols', label: 'Create Protocols', icon: '⊞' },
      { id: 'scoring-runs', label: 'Scoring Runs', icon: '◈' },
      { id: 'scoring-activity-logs', label: 'Scoring Activity Logs', icon: '▤' },
    ],
  },
  research: {
    label: 'Research',
    views: [
      { id: 'research-overview', label: 'Overview', icon: '◉' },
      { id: 'symbols-browser', label: 'Symbols', icon: '⊞' },
      { id: 'snapshots', label: 'Snapshots', icon: '📸' },
      { id: 'sector-rotation', label: 'Sector Rotation', icon: '◎' },
      { id: 'fluff-detector', label: 'Fluff Detector', icon: '📰' },
      { id: 'market-correlations', label: 'Market Correlations', icon: '⊡' },
      { id: 'news-intel', label: 'News Intel', icon: '◈' },
      { id: 'earnings-calendar', label: 'Earnings Calendar', icon: '◷' },
      { id: 'social-networks', label: 'Social Networks', icon: '⬡' },
      { id: 'price-forecast', label: 'Price Forecast', icon: '◆' },
      { id: 'events-calendar', label: 'Events Calendar', icon: '◷' },
      { id: 'macro-monitor', label: 'Macro Monitor', icon: '◎' },
    ],
  },
  analysis: {
    label: 'Analysis',
    views: [
      { id: 'recently-analysed-symbols', label: 'Recently Analysed Symbols', icon: '◉' },
      { id: 'support-resistance', label: 'Support & Resistance', icon: '▦' },
      { id: 'volatility-analysis', label: 'Volatility Analysis', icon: '▦' },
      { id: 'technical-indicators', label: 'Technical Indicators', icon: '⊞' },
      { id: 'pattern-scanner', label: 'Pattern Scanner', icon: '◆' },
      { id: 'chart-comparison', label: 'Chart Comparison', icon: '📊' },
      { id: 'analyse-symbol', label: 'Analyse Symbol', icon: '🔍' },
    ],
  },
  data: {
    label: 'Data',
    views: [
      { id: 'data-landing', label: 'Data Overview', icon: '◉' },
      { id: 'sources', label: 'Sources', icon: '⊞' },
      { id: 'import-jobs', label: 'Import Jobs', icon: '⇣' },
      { id: 'data-elements', label: 'Data Elements', icon: '⊡' },
      { id: 'decoder', label: 'Decoder', icon: '⊞' },
      { id: 'database-tables', label: 'Tables', icon: '▤' },
      { id: 'imports-history', label: 'Imports History', icon: '◈' },
      { id: 'api-activity', label: 'API Activity', icon: '◈' },
      { id: 'api-endpoints', label: 'API Endpoints', icon: '◉' },
      { id: 'transient-caches', label: 'Cache Monitor', icon: '◈' },
      { id: 'create-source', label: 'Create Source', icon: '⊞' },
      { id: 'api-keys', label: 'API Keys', icon: '⚙' },
    ],
  },
  watchlists: {
    label: 'Watchlists',
    views: [
      { id: 'active-symbols', label: 'Active Symbols', icon: '★' },
      { id: 'user-watchlists', label: 'User Watchlists', icon: '⊞' },
      { id: 'create-watchlist', label: 'Create Watchlist', icon: '⊞' },
      { id: 'add-symbol', label: 'Add Symbol', icon: '➕' },
    ],
  },
  automation: {
    label: 'Automation',
    views: [
      { id: 'automation-dashboard', label: 'Dashboard', icon: '◉' },
      { id: 'execution-queue', label: 'Execution Queue', icon: '⇢' },
      { id: 'automation-rules', label: 'Automation Rules', icon: '⚙' },
      { id: 'alert-center', label: 'Alert Center', icon: '◈' },
    ],
  },
  builder: {
    label: 'Development',
    views: [
      { id: 'architecture-framework', label: 'Architecture', icon: '⬡' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      { id: 'assets', label: 'Assets', icon: '⊞' },
      { id: 'component-lab', label: 'Component Lab', icon: '◉' },
      { id: 'theme-lab', label: 'Theme Lab', icon: '🎨' },
      { id: 'workflow-wizards', label: 'Workflow Wizards', icon: '⚙' },
    ],
  },
  status: {
    label: 'Status',
    views: [
      { id: 'status', label: 'System Status', icon: '◉' },
      { id: 'server-controls', label: 'Server Controls', icon: '⚡' },
      { id: 'mt5-status', label: 'MT5 Bridge Status', icon: '◈' },
      { id: 'platform-api-management', label: 'API Management', icon: '⚙' },
      { id: 'platform-comparisons', label: 'API Comparisons', icon: '▤' },
      { id: 'platform-api-efficiency', label: 'API Efficiency', icon: '◈' },
      { id: 'platform-switches', label: 'Platform Switches', icon: '⇢' },
      { id: 'risk-controls', label: 'Risk Controls', icon: '◈' },
      { id: 'security', label: 'Security', icon: '⚙' },
      { id: 'performance-lab', label: 'Protocol Performance', icon: '◈' },
      { id: 'analytics', label: 'Analytics', icon: '▦' },
      { id: 'audit-log', label: 'Audit Log', icon: '▤' },
      { id: 'setup', label: 'Setup Checklist', icon: '⊞' },
    ],
  },
  training: {
    label: 'Training',
    views: [
      { id: 'candle-patterns', label: 'Pattern Detection', icon: '◆' },
      { id: 'candle-patterns-guide', label: 'Candle Patterns', icon: '◉' },
    ],
  },
  settings: {
    label: 'Settings',
    views: [
      { id: 'settings', label: 'General', icon: '⚙' },
      { id: 'settings-database', label: 'Database', icon: '⊞' },
      { id: 'settings-education', label: 'Education', icon: '◉' },
      { id: 'theme-packs', label: 'Theme Packs', icon: '🎨' },
      { id: 'user-preferences', label: 'User Preferences', icon: '⚙' },
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
