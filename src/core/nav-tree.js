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
 *   - development → Development (developer tools: dynamic roadmap, more to come)
 *
 * ⚠️ ESM ONLY — the old `getFilteredNavStructure()` did
 * `const { isNavVisible } = require('./experience-levels')` "to avoid a circular
 * dependency". There is no cycle (`experience-levels.js` imports nothing), and in
 * the Vite/ESM bundle `require` is undefined, so the function would have thrown
 * `ReferenceError` the first time any caller ran it. It now uses a static import.
 */
import { isNavVisible } from './experience-levels';

export const NAV_TREE = {
  /**
   * Dashboard — MODULAR HUB (future)
   * ==================================
   * The Dashboard area is designed to become the primary modular view.
   * Future iterations will support user-configurable widget grids, drag-and-drop
   * layout persistence, and role-based card visibility.
   *
   * Currently renders the existing DashboardPage content inside the shared AppShell
   * layout (sidebar + breadcrumbs + topbar), replacing the previous standalone
   * /dashboard route that used a disconnected header.
   */
  dashboard: {
    label: 'Dashboard',
    views: [
      { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
    ],
  },
  // ── Accounts (was Trading212) ──
  trading212: {
    label: 'Accounts',
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
  // ── Research area (/research/ prefix) ──
  // Restored 2026-08-16: area was removed from the nav (pages remained registered
  // in view-routes.jsx). Individual symbol view: /research/symbol/:ticker.
  research: {
    label: 'Research',
    views: [
      { id: 'symbols-browser', label: 'Symbols Browser', icon: '🔍' },
      { id: 'screener', label: 'Screener', icon: '🧲' },
      { id: 'research-notes', label: 'Notes', icon: '📝' },
      { id: 'earnings-calendar', label: 'Earnings Calendar', icon: '📅' },
      { id: 'earnings-whispers', label: 'Earnings Whispers', icon: '🤫' },
      { id: 'news-intel', label: 'News Intel', icon: '📰' },
      { id: 'events-calendar', label: 'Events Calendar', icon: '🗓️' },
      { id: 'stock-investigation', label: 'Stock Investigation', icon: '🕵️' },
      { id: 'market-correlations', label: 'Market Correlations', icon: '🔗' },
      { id: 'recently-analysed-symbols', label: 'Recently Analysed', icon: '🕘' },
      { id: 'analyse-symbol', label: 'Analyse Symbol', icon: '🧪' },
    ],
  },
  // ── Protocols area (/protocols/ prefix) ──
  // Fully migrated from legacy /scoring/ area (2026-08-06).
  // API endpoints under /api/scoring/ are NOT affected — only frontend routes.
  protocols: {
    label: 'Protocols',
    views: [
      { id: 'protocols-registry', label: 'Protocols Registry', icon: '📋' },
      { id: 'directives-registry', label: 'Directives Registry', icon: '◆' },
      { id: 'protocols-ladder', label: 'Protocols Ladder', icon: '🪜' },
      { kind: 'section-header', id: 'tools-header', label: 'Tools', icon: '' },
      { id: 'sees-arena', label: 'Protocol Comparison', icon: '⚖️' },
      { id: 'configure-directives', label: 'Protocol Editor', icon: '⚙' },
      { id: 'protocol-builder', label: 'Protocol Builder', icon: '🧩' },
      { id: 'protocol-trail', label: 'Protocol Trail', icon: '🔗' },
      { id: 'directive-viewer', label: 'Directive Viewer', icon: '🔍' },
      { id: 'dual-protocol-inspector', label: 'Dual-Protocol Inspector', icon: '🔬' },
    ],
  },
  // ── Scoring area (/scoring/ prefix) ──
  // Monitoring SEES: every ladder, all scores (incl. poor ones). Renamed from
  // /scoringStrategies/ (2026-08-19). Symbols Ladder + Singles Monitor moved here
  // from the Protocols area. API endpoints under /api/scoring/ are unaffected.
  scoring: {
    label: 'Scoring',
    views: [
      { id: 'live-ordering-stack', label: 'Ladder', icon: '◉' },
      { id: 'symbols-ladder', label: 'Symbols Ladder', icon: '📈' },
      { id: 'singles-monitor', label: 'Singles Monitor', icon: '🖥' },
      { id: 'scoring-activity-logs', label: 'Scoring Activity Logs', icon: '▤' },
    ],
  },
  // ── Signals area (/signals/ prefix) ──
  // Best-of opportunities with trade actions + bot-action indicators (new 2026-08-19).
  signals: {
    label: 'Signals',
    views: [
      { id: 'signals-overview', label: 'Signals', icon: '🚩' },
    ],
  },
  trading: {
    label: 'Trading',
    views: [
      { id: 'strategy-monitor', label: 'Strategy Monitor', icon: '📊' },
      // ── BOTS ──
      // `Trading Bots` = a BOT, per `docs/trading-bot-model.md` §1: the EXECUTION POLICY (a
      // `TradingStrategy` row) - money management, risk, entry/exit rules, position building. The
      // Strategy Monitor above is the WHOLE PIPELINE (protocol + bot), which is a different thing.
      // §5 (user-confirmed) is explicit that the display label is "Trading Bots".
      { id: 'trading-bots', label: 'Trading Bots', icon: '🤖' },
      // Renamed from `strategy-create` 2026-09-18: it creates a BOT row, so "Create Strategy"
      // named the wrong layer. The alias `create-strategy` was removed - it mapped to this same
      // component and nothing navigated to it except three stale QA procedure strings.
      { id: 'bot-create', label: 'Create Bot', icon: '⊞' },
      // ── STRATEGIES (derived) ──
      // The owner's definition (docs/trading-bot-model.md §1c): "a strategy is about different
      // treatment of a symbol". A strategy is a distinct (protocol x treatment) combination, which
      // is a DIFFERENT thing from a bot. 26 bots -> 18 strategies. Placed directly under Trading
      // Bots so the pair reads as "the execution policy" vs "the combinations", which is the frame
      // the four legacy `strategy`-labelled pages above fail to make (they all render bots).
      { id: 'strategies-derived', label: 'Strategies', icon: '🧩' },
      { id: 'positions-monitor', label: 'Positions Monitor', icon: '◈' },
      { id: 'trading-strategies', label: 'Trading Strategies', icon: '◆' },
      { id: 'strategy-comparison', label: 'Trading Strategy Comparison', icon: '⚖' },
      { id: 'trading-plans', label: 'Trading Plans', icon: '📋' },
      { id: 'exit-signals', label: 'Exit Signals', icon: '🚪' },
      { kind: 'section-header', id: 'legacy-strategies', label: '— Legacy Strategy Pages —', icon: '' },
      { id: 'market-context', label: 'Market Context', icon: '🌐' },
      { id: 'strategy-library', label: 'Strategy Library', icon: '📚' },
      { id: 'performance-lab', label: 'Trading Performance', icon: '📊' },
      { id: 'trade-journal', label: 'Trade Journal', icon: '▤' },
      { id: 'calculators', label: 'Calculators', icon: '⊞' },
      { id: 'accounts-dashboard', label: 'Accounts', icon: '💰' },
      { id: 'trading-settings', label: 'Settings', icon: '⚙' },
    ],
  },
  automation: {
    label: 'Automation',
    views: [
      { id: 'automation-dashboard', label: 'Dashboard', icon: '◉' },
      { id: 'automation-overview', label: 'Overview', icon: '📋' },
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
      { id: 'glossary', label: 'Glossary', icon: '📖' },
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
      { id: 'platform-comparisons', label: 'API Comparisons', icon: '▤' },
      // ── System Maps ──
      { id: 'meta-stack-explorer', label: 'META.Stack Explorer', icon: '🔍' },
      { id: 'meta-stack-pipeline', label: 'META.Stack Pipeline', icon: '🔗' },
      { id: 'meta-stack-status', label: 'META.Stack Status', icon: '🎯' },
      { id: 'architecture-framework', label: 'Architecture', icon: '⬡' },
      { id: 'file-inventory', label: 'File Inventory', icon: '📁' },
      { id: 'analytics', label: 'Analytics', icon: '▦' },
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
      { id: 'pipeline-graph-lab', label: 'Pipeline Graph', icon: '🗺️' },
      // ── Engineering Tools ──
      { id: 'feature-lab', label: 'Feature Lab', icon: '🔬' },
      { id: 'component-lab', label: 'Component Lab', icon: '🧩' },
      { id: 'widget-library', label: 'Widget Library', icon: '⬚' },
      { id: 'screen-assignment', label: 'Screen Assignment', icon: '🖥️' },
      { id: 'diagrams', label: 'Diagrams', icon: '▦' },
      { id: 'meta-stack-cockpit', label: 'META.Stack Cockpit', icon: '🧭' },
      { id: 'responsive-layout-lab', label: 'Responsive Layout Lab', icon: '📐' },
      // ── Theme Engineering ──
      { id: 'theme-lab', label: 'Theme Lab', icon: '🎨' },
      { id: 'theme-lab-motion', label: 'Motion Lab', icon: '◆' },
      { id: 'theme-lab-transitions', label: 'Transitions Lab', icon: '⇢' },
      { id: 'theme-lab-scroll', label: 'Scroll Animations', icon: '⇣' },
      { id: 'theme-lab-popover', label: 'Popover API', icon: '◉' },
      // ── Prototypes ──
      { id: '_divider_prototypes', label: 'Prototypes', icon: '🧪', kind: 'section-header' },
      { id: 'allocator', label: 'Strategy Allocator', icon: '📊' },
      { id: 'ab-testing', label: 'A/B Protocol Testing', icon: '⚖️' },
      { id: 'snapshot-replay', label: 'Snapshot Replay', icon: '⏮' },
      { id: 'charts-lab', label: 'Charts Lab', icon: '📊' },
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
      { id: 'position-lifecycle', label: 'Position Lifecycle', icon: '🛡️' },
      { id: 'ai-costs', label: 'AI Costs', icon: '🤖' },
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
  // ── Settings area (/settings/ prefix) ──
  //
  // ⚠️ ORDERING IS THE DESIGN, NOT ALPHABETICAL (2026-09-16, #617).
  // The list is grouped by the QUESTION each page answers, because the previous flat list gave
  // the user no reason to expect any setting on any page — "General" had accumulated 13
  // sections from theme to trade thresholds precisely because there was no rule about what
  // belonged where. The rule now is the META.Stack layers:
  //
  //   directives → protocols → scoring → bots
  //
  // A page that configures a layer comes first and sits with the other layers. "General" is
  // the LAST resort — everything a user can change that is NOT part of a layer (API, database,
  // security) — and it appears under Application, below the layers, rather than at the top
  // pretending to be the front door.
  //
  // Decisions behind the grouping (#617): Automation owns the loop + queue + layer inclusion
  // switches; each layer's switch is DUPLICATED onto its own page on purpose, so the link
  // between the loop and the layer is visible from either end.
  settings: {
    label: 'Settings',
    views: [
      // ── META.Stack layers ──
      { kind: 'section-header', id: 'settings-layers', label: 'META.Stack Layers', icon: '' },
      { id: 'trading-settings', label: 'Trading', icon: '💹' },
      { id: 'scoring-settings', label: 'Scoring', icon: '📊' },
      { id: 'automation', label: 'Automation', icon: '⚡' },
      { id: 'risk-controls', label: 'Risk Controls', icon: '◈' },
      // ── Application ──
      { kind: 'section-header', id: 'settings-app', label: 'Application', icon: '' },
      { id: 'settings', label: 'General', icon: '⚙' },
      { id: 'appearance', label: 'Appearance', icon: '🎨' },
      { id: 'monitoring', label: 'Monitoring', icon: '🛰' },
      // ── Reference — the full lists, not the everyday surfaces ──
      { kind: 'section-header', id: 'settings-reference', label: 'Reference', icon: '' },
      { id: 'user-preferences', label: 'User Preferences', icon: '⚙' },
      { id: 'theme-packs', label: 'Theme Packs', icon: '🎨' },
      { id: 'settings-database', label: 'Database', icon: '⊞' },
      { id: 'settings-education', label: 'Education', icon: '◉' },
    ],
  },
  // ── Development — developer-only tooling, separated on the right ──
  development: {
    label: 'Development',
    views: [
      { id: 'roadmap', label: 'Roadmap', icon: '🗺' },
      { id: 'qa-testing', label: 'QA Checklist', icon: '🧪' },
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
