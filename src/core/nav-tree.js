/**
 * Navigation Tree — Single source of truth for the shell layout.
 *
 * Areas map to footer/quick-menu primary items.
 * Each area's `views` array drives the left sidebar.
 *
 * Current areas (13):
 *   - trading    → Trading (SEES tabs, strategies, portfolio, MT5)
 *   - scoring    → Scoring (directives, protocols, SEES diagnostics)
 *   - research   → Research (symbols, snapshots, macro, news, events)
 *   - analysis   → Analysis (S&R, volatility, indicators, patterns, charts)
 *   - data       → Data (sources, tables, imports, API activity, caches)
 *   - watchlists → Watchlists (active symbols, user lists)
 *   - automation → Automation (execution queue, rules, alerts)
 *   - planner    → Planner (finances, trading styles, objectives)
 *   - builder    → Development (architecture, diagrams, assets, lab tools)
 *   - training   → Training (candle patterns, order testing, MT5 demo)
 *   - status     → Status (system health, platform, risk, security)
 *   - lab        → Lab (sandbox, theme lab, motion lab, component lab)
 *   - settings   → Settings (general, database, theme packs, preferences)
 */

export const NAV_TREE = {
  trading: {
    label: 'Trading',
    views: [
      { id: 'trading-strategies', label: 'Trading Strategies', icon: '◆' },
      { id: 'portfolio-overview', label: 'Portfolio Overview', icon: '◉' },
      { id: 'stock-investigation', label: 'Stock Investigation', icon: '🔍' },
      { id: 'portfolio-events', label: 'Portfolio Events', icon: '📅' },
      { id: 'trade-history', label: 'Trade History', icon: '◈' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      { id: 'trade-journal', label: 'Trade Journal', icon: '▤' },
      // { id: 'btc-speed', label: 'Bitcoin Speed', icon: '₿' },  // MOCK — awaiting crypto-enabled MT5 broker
      { id: 'trading-plans', label: 'Trading Plans', icon: '📋' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'accounts-dashboard', label: 'Accounts', icon: '💰' },
    ],
  },
  scoring: {
    label: 'Scoring',
    views: [
      { id: 'directives-manager', label: 'Directives', icon: '◆' },
      { id: 'live-ordering-stack', label: 'Live Ordering Stack', icon: '◉' },
      { id: 'sees-advanced', label: 'SEES Advanced', icon: '◆' },
      { id: 'signals-workbench', label: 'Signals Workbench', icon: '◈' },
      { id: 'exit-signals', label: 'Exit Signals', icon: '🚪' },
      { id: 'sees-arena', label: 'SEES Arena', icon: '◆' },
      { id: 'protocols', label: 'Protocols 📋', icon: '📋' },
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
      { id: 'sector-rotation', label: 'Sector Rotation', icon: '◎' },
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
      { id: 'backtest-data', label: 'Backtest Data', icon: '⧖' },
      { id: 'decoder', label: 'Decoder', icon: '⊞' },
      { id: 'database-tables', label: 'Tables', icon: '▤' },
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
      { id: 'speed-scanner', label: 'Speed Scanner', icon: '⚡' },
      { id: 'automation-dashboard', label: 'Dashboard', icon: '◉' },
      { id: 'execution-queue', label: 'Execution Queue', icon: '⇢' },
      { id: 'strategies-compare', label: 'Strategy Comparison', icon: '⇆' },
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
      { id: 'workflow-wizards', label: 'Workflow Wizards', icon: '⚙' },
      // ── Lab (remaining) ──
      { id: 'theme-lab-container', label: 'Container Queries', icon: '⊡' },
      { id: 'theme-lab-popover', label: 'Popover API', icon: '◉' },
      { id: 'algorithm-lab', label: 'Algorithm Log', icon: '📐' },
      { id: 'backtest', label: 'Backtest Engine', icon: '⬡' },
      { id: 'performance-lab', label: 'Protocol Performance', icon: '📊' },
    ],
  },
  training: {
    label: 'Training',
    views: [
      { id: 'candle-patterns', label: 'Pattern Detection', icon: '🕯️' },
      { id: 'candle-patterns-guide', label: 'Candle Patterns', icon: '◉' },
      { id: 'order-testing', label: 'Order Testing', icon: '🧪' },
      { id: 'mt5-demo-trading', label: 'MT5 Demo Trading', icon: '🎮' },
    ],
  },
  status: {
    label: 'Status',
    views: [
      // ── System Health ──
      { id: 'status', label: 'System Status', icon: '◉' },
      // ── Platform ──
      { id: 'platform-api-management', label: 'API Management', icon: '⚙' },
      { id: 'platform-comparisons', label: 'API Comparisons', icon: '▤' },
      { id: 'platform-api-efficiency', label: 'API Efficiency', icon: '◈' },
      { id: 'platform-switches', label: 'Platform Switches', icon: '⇢' },
      // ── Risk & Security ──
      { id: 'risk-controls', label: 'Risk Controls', icon: '◈' },
      { id: 'security', label: 'Security', icon: '⚙' },
      { id: 'analytics', label: 'Analytics', icon: '▦' },
      { id: 'audit-log', label: 'Audit Log', icon: '▤' },
      { id: 'setup', label: 'Setup Checklist', icon: '⊞' },
      { id: 'capability-map', label: 'Capability Map', icon: '🗺️' },
    ],
  },
  lab: {
    label: 'Lab',
    views: [
      { id: 'lab', label: 'Lab Sandbox', icon: '🔬' },
      { id: 'lab-landing', label: 'Lab Overview', icon: '🔬' },
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'theme-lab', label: 'Theme Lab', icon: '🎨' },
      { id: 'theme-lab-motion', label: 'Motion Lab', icon: '◆' },
      { id: 'theme-lab-transitions', label: 'Transitions Lab', icon: '⇢' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', icon: '⇣' },
      { id: 'component-lab', label: 'Component Lab', icon: '🧩' },
      { id: 'charts-lab', label: 'Charts Lab', icon: '📊' },
      { id: 'snapshot-replay', label: 'Snapshot Replay', icon: '⏮' },
      { id: 'scoring-overview', label: 'Theme Example: Scoring Overview', icon: '🎨' },
      { id: 'mt5-trading', label: 'MT5 Trading (Lab)', icon: '🔬' },
      { id: 'speed-trading', label: 'Speed Trading (Lab)', icon: '🔬' },
      { id: 'gold-speed', label: 'Gold Speed (Lab)', icon: '🔬' },
      { id: 'trading212-portfolio', label: 'Trading212 Portfolio (Lab)', icon: '🔬' },
      { id: 'snapshots', label: 'Snapshots (Lab)', icon: '🔬' },
      { id: 'portfolio-lab', label: 'Portfolio Lab', icon: '🧪' },
    ],
  },
  wizard: {
    label: 'Strategy Wizard',
    views: [
      { id: 'strategy-wizard', label: 'Build Strategy', icon: '🧙' },
    ],
  },
  planner: {
    label: 'Planner',
    views: [
      { id: 'personal-finances', label: 'Personal Finances', icon: '💰' },
      { id: 'trading-styles', label: 'Trading Styles', icon: '🎨' },
      { id: 'objectives', label: 'Objectives', icon: '🎯' },
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
