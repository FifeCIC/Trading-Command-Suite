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
    'The Ladder ranks symbols by their composite score across all enabled protocols. ' +
    'Higher-ranked symbols have stronger, more consistent signals. ' +
    'Use the filters to narrow by sector, exchange, or score range. ' +
    'Click any symbol to drill into its directive breakdown.',

  'metastack-display':
    'META.Stack is the protocol system — building blocks of trading logic. ' +
    'Each protocol defines a set of directives (rules) that score symbols. ' +
    'Protocols can be chained into strategies. ' +
    'This view lets you inspect protocol definitions, directive groups, and version history.',

  'directives-manager':
    'The Directive Registry is the master catalog of all scoring rules. ' +
    'Each directive is a self-contained scoring function — e.g. "RSI below 30 → bullish." ' +
    'Directives are grouped into protocols which are assembled into strategies. ' +
    'Enable/disable directives to tune what drives your scores.',

  'strategy-comparison':
    'Side-by-side comparison of strategy performance. ' +
    'Each strategy is a chain of protocols run against a symbol universe. ' +
    'Compare total trades, win rate, P&L, and drawdown to find the best-performing strategies. ' +
    'Click a strategy to see its full trade history and protocol breakdown.',

  // ── Trading / Data ──
  'active-symbols':
    'Browse all symbols that are currently active in the system. ' +
    'Active = has positions, is in a watchlist, or is assigned to a protocol. ' +
    'Filter by exchange, sector, or activity status. ' +
    'Click a symbol to open its full research page.',
};
