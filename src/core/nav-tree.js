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
  dashboard: {
    label: 'Dashboard',
    views: [
      { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    ],
  },
  qa: {
    label: 'QA',
    views: [
      { id: 'qa-testing', label: 'QA Checklist', icon: '🧪' },
      { id: 'order-testing', label: 'Order Testing', icon: '🧪' },
    ],
  },
  watchlists: {
    label: 'Watchlists',
    views: [
      { id: 'active-symbols', label: 'Active Symbols', icon: '★' },
      { id: 'user-watchlists', label: 'Watchlists', icon: '⊞' },
      { id: 'add-symbol', label: 'Add Symbol', icon: '➕' },
    ],
  },
  scoring: {
    label: 'Scoring',
    views: [
      { id: 'directives-manager', label: 'Directives', icon: '◆' },
      { id: 'configure-directives', label: 'Protocol Editor', icon: '⚙' },
      { id: 'live-ordering-stack', label: 'Live Ordering Stack', icon: '◉' },
      { id: 'signals-workbench', label: 'Signals Ladder', icon: '◈' },
      { id: 'exit-signals', label: 'Exit Signals', icon: '🚪' },
      { id: 'sees-arena', label: 'SEES Arena', icon: '◆' },
      { id: 'protocols', label: 'Protocols 📋', icon: '📋' },
      { id: 'create-protocols', label: 'Create Protocols', icon: '⊞' },
      { id: 'scoring-runs', label: 'Scoring Runs', icon: '◈' },
      { id: 'scoring-activity-logs', label: 'Scoring Activity Logs', icon: '▤' },
    ],
  },
  trading: {
    label: 'Trading',
    views: [
      { id: 'market-context', label: 'Market Context', icon: '🌐' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      { id: 'trading-strategies', label: 'Trading Strategies', icon: '◆' },
      { id: 'create-strategy', label: 'Create Strategy', icon: '⊞' },
      { id: 'strategy-comparison', label: 'Strategy Comparison', icon: '⚖' },
      { id: 'trade-journal', label: 'Trade Journal', icon: '▤' },
      { id: 'trading-plans', label: 'Trading Plans', icon: '📋' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'accounts-dashboard', label: 'Accounts', icon: '💰' },
    ],
  },
  automation: {
    label: 'Automation',
    views: [
      { id: 'automation-dashboard', label: 'Dashboard', icon: '◉' },
      { id: 'speed-scanner', label: 'Speed Scanner', icon: '⚡' },
      { id: 'execution-queue', label: 'Execution Queue', icon: '⇢' },
      { id: 'strategies-compare', label: 'Multi-Strategy Compare', icon: '⇆' },
      { id: 'automation-rules', label: 'Bot Rules', icon: '⚙' },
      { id: 'alert-center', label: 'Alert Center', icon: '◈' },
    ],
  },
  research: {
    label: 'Development',
    views: [
      { id: 'architecture-framework', label: 'Architecture', icon: '⬡' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      { id: 'assets', label: 'Assets', icon: '⊞' },
      // ── Lab (remaining) ──
      { id: 'theme-lab-container', label: 'Container Queries', icon: '⊡' },
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
      // ── Security ──
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
      { id: 'pipeline-graph-lab', label: 'Pipeline Graph (Prototype)', icon: '🗺️' },
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'theme-lab', label: 'Theme Lab', icon: '🎨' },
      { id: 'theme-lab-motion', label: 'Motion Lab', icon: '◆' },
      { id: 'theme-lab-transitions', label: 'Transitions Lab', icon: '⇢' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', icon: '⇣' },
      { id: 'theme-lab-popover', label: 'Popover API', icon: '◉' },
      { id: 'component-lab', label: 'Component Lab', icon: '🧩' },
      { id: 'responsive-layout-lab', label: 'Responsive Layout Lab', icon: '📐' },
      { id: 'charts-lab', label: 'Charts Lab', icon: '📊' },
      { id: 'snapshot-replay', label: 'Snapshot Replay', icon: '⏮' },
      { id: 'metastack-display', label: 'M.E.T.A. Display', icon: '📐' },
      { id: 'scoring-overview', label: 'Theme Example: Scoring Overview', icon: '🎨' },
      { id: 'scoring-debug-lab', label: 'Scoring Debug (Dual Protocol)', icon: '🔬' },
      { id: 'mt5-trading', label: 'MT5 Trading (Lab)', icon: '🔬' },
      { id: '_divider_prototypes', label: 'Prototypes', icon: '🧪', kind: 'section-header' },
      { id: 'speed-trading', label: 'Speed Trading (Lab)', icon: '🔬' },
      { id: 'gold-speed', label: 'Gold Speed (Lab)', icon: '🔬' },
      { id: 'snapshots', label: 'Snapshots (Lab)', icon: '🔬' },
      { id: 'portfolio-lab', label: 'Portfolio Lab', icon: '🧪' },
      { id: 'timeline', label: 'Timeline (Lab)', icon: '📅' },
      { id: 'triple-screen', label: 'Triple-Screen Cockpit', icon: '🖥️' },
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
      { id: 'risk-controls', label: 'Risk Controls', icon: '◈' },
      { id: 'platform-switches', label: 'Platform Switches', icon: '⇢' },
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
 * Filter nav structure by experience level.
 * Returns the same shape as getNavStructure() but with beginner/experienced views removed.
 * @param {'beginner'|'experienced'|'expert'} level
 */
export function getFilteredNavStructure(level) {
  // Lazy import to avoid circular dependency
  const { isNavVisible } = require('./experience-levels');
  const structure = {};
  for (const [key, area] of Object.entries(NAV_TREE)) {
    const filtered = area.views.filter(v => isNavVisible(v.id, level));
    if (filtered.length > 0) {
      structure[key] = filtered;
    }
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
