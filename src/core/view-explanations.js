/**
 * View Explanations Registry
 * ===========================
 * Maps view IDs to explanation text shown in the Screen Options info popover (ℹ️).
 *
 * When adding a new view:
 * 1. Add an entry below with a clear, concise explanation
 * 2. The info icon automatically appears in so-sticky-btns for registered views
 *
 * @see src/components/ScreenOptions.jsx
 */

export const VIEW_EXPLANATIONS = {
  // ── Dashboard ──
  // ⚠️ ADDED 2026-10-11. The key is the NAV-TREE view id (`dashboard`), NOT the route
  // (`/dashboard/dashboard`) — App.jsx looks this up as `VIEW_EXPLANATIONS[secondaryView]`, so a
  // route-shaped key would render nothing and give no error. Its absence was measured: 46 entries,
  // none for the dashboard, so the ℹ control in the shell's top row never appeared here.
  'dashboard':
    'Your modular home view — a board of widgets you can drag, resize and remove, with the arrangement ' +
    'saved. The tick strip above shows the automation loop and its risk state. "Fill width" re-packs ' +
    'the tiles across the full grid after you add or remove widgets; nothing moves until you press it.',

  // ── Speed Trading ──
  'speed-scanner':
    'Scores each symbol across all active directives in real-time. ' +
    'Composite % = percentage of max possible score. ' +
    'Trend clarity is derived from ADX + pattern count. ' +
    'Recommendations are trade (strong signal with clear trend), ' +
    'caution (mixed signals), or pause (weak/conflicting). ' +
    'Scores follow the protocol\'s directional bias — a low composite on a short-biased protocol may still signal SELL. ' +
    'Trust the recommendation over raw composite for direction.',

  // ── Scoring ──
  'sees-arena':
    'Compares how different scoring protocols rate the same symbol side by side. ' +
    'Each column is a protocol, each row a symbol. ' +
    'Green = protocol scores it high (bullish), red = low (bearish). ' +
    'Use this to see where protocols agree or disagree before making a trade decision.',

  'live-ordering-stack':
    'One card per (protocol × symbol), ranked by the metric the “Score” control selects — ' +
    'Signal (timing: directional conviction) or Opportunity (ranking: everything counts). ' +
    'A card showing NO_READING at 0 means the protocol’s own direction had no reading that tick — ' +
    'the ℹ beside the page title explains why that is a direction result and not a lost score. ' +
    'Filters narrow by protocol, age, market, direction and search; click a card to drill into ' +
    'its directive breakdown.',

  'directives-registry':
    'The Directive Registry is the master catalog of all scoring rules. ' +
    'Each directive is a self-contained scoring function — e.g. "RSI below 30 → bullish." ' +
    'Directives are grouped into protocols which are assembled into strategies. ' +
    'Enable/disable directives to tune what drives your scores.',

  'strategy-comparison':
    'Side-by-side comparison of trading strategy performance. ' +
    'Each trading strategy is one symbol scored by one protocol on one broker. ' +
    'Compare total trades, win rate, P&L, and drawdown to find the best-performing strategies. ' +
    'Click a strategy to see its full trade history and protocol breakdown.',

  // ── Trading / Data ──
  'active-symbols':
    'Browse all symbols that are currently active in the system. ' +
    'Active = has positions, is in a watchlist, or is assigned to a protocol. ' +
    'Filter by exchange, sector, or activity status. ' +
    'Click a symbol to open its full research page.',

  'symbols-browser':
    'The Symbols Browser lists every symbol in your database alongside live ' +
    'position, P&L and market-data freshness details. ' +
    'Use the gear button to choose which columns appear — position sub-details ' +
    '(provider, quantity, prices), freshness timings, tags, aliases and record ' +
    'timestamps can all be shown. Click a row to inspect the symbol in the detail rail.',

  'screener':
    'The Screener ranks catalyst events — upcoming earnings and recent news ' +
    'mentions — by attention weight (strength × source reliability × how close ' +
    'the event is). It surfaces what deserves a look, not directional conviction: ' +
    'scoring happens later, after a symbol is promoted to a watchlist. ' +
    'The strip at the top shows how many symbols were filtered out so the app ' +
    'stays transparent about what it is ignoring.',
};
