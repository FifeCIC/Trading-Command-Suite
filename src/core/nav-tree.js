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
    ],
  },
  // ── Trading212 Integration (Phase 1: visible when provider is activated) ──
  trading212: {
    label: 'Trading212',
    views: [
      { id: 't212-portfolio', label: 'Portfolio', icon: '🏦' },
      { id: 't212-isa', label: 'Stocks ISA', icon: '🏛️' },
      { id: 't212-cfd', label: 'CFD', icon: '📉' },
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
      { id: 'directive-detail', label: 'Directive Detail', icon: '🔬', hidden: true },
      { id: 'configure-directives', label: 'Protocol Editor', icon: '⚙' },
      { id: 'live-ordering-stack', label: 'Ladder', icon: '◉' },
      { id: 'signals-workbench', label: 'Scoring Workbench', icon: '◈' },
      { id: 'exit-signals', label: 'Exit Signals', icon: '🚪' },
      { id: 'sees-arena', label: 'SEES Arena', icon: '◆' },      { id: 'strategy-ladders', label: 'Strategy Ladders', icon: '🪜' },      { id: 'protocols', label: 'Protocols 📋', icon: '📋' },
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
      { id: 'strategy-library', label: 'Strategy Library', icon: '📚' },
      { id: 'strategy-dashboard', label: 'Strategy Dashboard', icon: '📊' },
      { id: 'create-strategy', label: 'Create Strategy', icon: '⊞' },
      { id: 'strategy-comparison', label: 'Strategy Comparison', icon: '⚖' },
      { id: 'performance-lab', label: 'Trading Performance', icon: '📊' },
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
      { id: 'decision-trail', label: 'Decision Trail', icon: '🔗' },
      { id: 'speed-scanner', label: 'Speed Scanner', icon: '⚡' },
      { id: 'execution-queue', label: 'Execution Queue', icon: '⇢' },
      { id: 'automation-rules', label: 'Automation Rules', icon: '⚙' },
      { id: 'alert-center', label: 'Alert Center', icon: '◈' },
    ],
  },
  education: {
    label: 'Education',
    views: [
      { id: 'candle-patterns', label: 'Pattern Detection', icon: '🕯️' },
      { id: 'candle-patterns-guide', label: 'Candle Patterns', icon: '◉' },
      { id: 'mt5-demo-trading', label: 'MT5 Demo Trading', icon: '🎮' },
      { id: 'backtest', label: 'Backtest Engine', icon: '⬡' },
      { id: 'settings-education', label: 'Education Settings', icon: '⚙' },
    ],
  },
  status: {
    label: 'Status',
    views: [
      // ── System Health ──
      { id: 'setup', label: 'Setup & Diagnostics', icon: '◉' },
      { id: 'health-check', label: 'Health & Diagnostics', icon: '🩺' },
      { id: 'commands', label: 'Commands Reference', icon: '💻' },
      { id: 'system-log', label: 'System Log', icon: '📋' },
      // ── Platform ──
      { id: 'platform-api-management', label: 'API Management', icon: '⚙' },
      { id: 'platform-comparisons', label: 'API Comparisons', icon: '▤' },
      { id: 'platform-api-efficiency', label: 'API Efficiency', icon: '◈' },
      // ── System Maps ──
      { id: 'architecture-framework', label: 'Architecture', icon: '⬡' },
      { id: 'file-inventory', label: 'File Inventory', icon: '📁' },
      // ── Security ──
      { id: 'security', label: 'Security', icon: '⚙' },
      { id: 'analytics', label: 'Analytics', icon: '▦' },
      { id: 'audit-log', label: 'Audit Log', icon: '▤' },
      { id: 'ai-logs', label: 'AI Logs', icon: '📋' },
      { id: 'capability-map', label: 'Capability Map', icon: '🗺️' },
    ],
  },
  lab: {
    label: 'Lab',
    views: [
      // ── Overview ──
      { id: 'lab', label: 'Lab Sandbox', icon: '🔬' },
      { id: 'lab-landing', label: 'Lab Directory', icon: '🗂️' },
      // ── META.Stack Pipeline ──
      { id: 'meta-stack-explorer', label: 'META.Stack Explorer', icon: '🔍' },
      { id: 'metastack-display', label: 'META.Stack Display', icon: '📐' },
      { id: 'metastack-performance', label: 'MetaStack Performance', icon: '📊' },
      { id: 'pipeline-graph-lab', label: 'Pipeline Graph', icon: '🗺️' },
      { id: 'scoring-debug-lab', label: 'Scoring Debug (Dual Protocol)', icon: '🔬' },
      { id: 'ab-testing', label: 'A/B Protocol Testing', icon: '⚖️' },
      { id: 'snapshot-replay', label: 'Snapshot Replay', icon: '⏮' },
      // ── Engineering Tools ──
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'component-lab', label: 'Component Lab', icon: '🧩' },
      { id: 'charts-lab', label: 'Charts Lab', icon: '📊' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      { id: 'triple-screen', label: 'Triple-Screen Cockpit', icon: '🖥️' },
      { id: 'responsive-layout-lab', label: 'Responsive Layout Lab', icon: '📐' },
      // ── Theme Engineering ──
      { id: 'theme-lab', label: 'Theme Lab', icon: '🎨' },
      { id: 'theme-lab-motion', label: 'Motion Lab', icon: '◆' },
      { id: 'theme-lab-transitions', label: 'Transitions Lab', icon: '⇢' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', icon: '⇣' },
      { id: 'theme-lab-popover', label: 'Popover API', icon: '◉' },
      // ── Prototypes ──
      { id: '_divider_prototypes', label: 'Prototypes', icon: '🧪', kind: 'section-header' },
      { id: 'speed-trading', label: 'Speed Trading', icon: '⚡' },
      { id: 'gold-speed', label: 'Gold Speed', icon: '🔬' },
      { id: 'mt5-trading', label: 'MT5 Trading (Lab)', icon: '🔬' },
      { id: 'daily-briefing', label: 'Daily Briefing', icon: '📋' },
      { id: 'hot-stock-picks', label: 'Hot Stock Picks', icon: '🔥' },
      { id: 'daily-summary-report', label: 'Daily Summary Report', icon: '📋' },
      { id: 'strategy-wizard', label: 'Strategy Wizard', icon: '🧙' },
      { id: 'portfolio-lab', label: 'Portfolio Lab', icon: '🧪' },
      { id: 'timeline', label: 'Timeline', icon: '📅' },
      { id: 'snapshots', label: 'Snapshots', icon: '🔬' },
      { id: 'ai-costs', label: 'AI Costs', icon: '🤖' },
    ],
  },
  planner: {
    label: 'Planner',
    views: [
      { id: 'allocator', label: 'Strategy Allocator', icon: '📊' },
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
