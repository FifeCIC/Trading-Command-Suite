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
  'brokers':
    'Every trading venue this app knows about, and the accounts held on each. Expanding a row shows ' +
    'the venue’s fees, the trade types it offers, how its API works, and every account on it. ' +
    'Balances are read from the broker, never calculated here. “In totals” says whether an account ' +
    'is counted in the portfolio: an account that is enabled but disconnected contributes nothing, ' +
    'and says so. Removing an MT5 account edits that bridge’s own account list, so the terminal ' +
    'disconnects it; removing a Trading 212 or Capital.com account only takes it out of this app, ' +
    'because its credential lives in the API environment file.',

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

  'strategies':
    'Every strategy we have written down, whether or not it is running. Each entry is a THEORY: what ' +
    'it believes about the market, which directives express that belief, and what would prove it ' +
    'wrong. A strategy with a live view also has its own page — the finished product, where the feed ' +
    'the strategy would consume is shown as it is right now, with its age attached. Opening a live ' +
    'view is not the same as the strategy trading: the status card on each one says which.',

  'day-top-winners':
    'The long half of the day’s movers idea. Candidates are the biggest gainers in the whole market — ' +
    'including symbols we do not hold — because the theory is momentum continuation, and a symbol ' +
    'cannot be a mover if we only ever look at our own universe. The list is live but the strategy is ' +
    'NOT trading: no protocol is wired to it yet, so nothing is scored, sized or entered.',

  'day-top-losers':
    'The short half of the day’s movers idea, and deliberately not the winners page with the sign ' +
    'flipped: a short’s gain is capped while its loss is not, borrow cost accrues, a collapsing stock ' +
    'may not be shortable at all, and a squeeze arrives faster than a long-side reversal. The list is ' +
    'live; the strategy is not trading, because no protocol is wired to it yet.',

  'most-active':
    'Ranked by VOLUME, which has no direction — a name can top this list while closing flat. What it ' +
    'gives you is where liquidity and attention are concentrated, which is a candidate universe for a ' +
    'directional strategy rather than a thesis of its own. That is why it lives in Research and not ' +
    'in the Strategies area.',

  'registered-movers':
    'Bounded by what we hold: for each symbol in our universe that moved most in the chosen window, ' +
    'every question at once — what it scored, whether anything is subscribed to act on it, what is ' +
    'open or queued, and what the loop last decided. Every tally is a STATUS: the number is the ' +
    'answer and the detail sits on demand (hover, focus, or click to pin). The market-wide question — ' +
    'what is moving anywhere that we are not looking at? — is /development/movers-treatment.',

  'movers-treatment':
    'Bounded by nothing: the biggest winners and losers in the whole market, including symbols we do ' +
    'not hold and have never scored — which is the point, because a symbol can be the largest mover ' +
    'of the day and appear nowhere in our universe. The feed is live, but its AGE is shown and a ' +
    'stale feed is refused rather than presented as today’s opportunity. Exclusions are listed with ' +
    'their reason, so a filter that drops most of its input stays visible instead of looking like a ' +
    'short list. The question about OUR symbols — what is TCS doing with the movers we hold? — is ' +
    '/watchlists/registered-movers.',

  'queued-changes':
    'Every protocol and bot change we have written down but not yet made — the working list behind ' +
    '“what are we about to try?”, moved out of the bots page because it is a list of edits we are ' +
    'considering, not a record of trading. Each row names its kind, its target, who queued it and ' +
    'the issue that justifies it; a row with no issue says so rather than looking finished, and a ' +
    'row naming a directive that does not exist yet is a placeholder to build, never something you ' +
    'could attach. Nothing here is applied by this page: status is a record of what someone did.',

  'screener':
    'The Screener ranks catalyst events — upcoming earnings and recent news ' +
    'mentions — by attention weight (strength × source reliability × how close ' +
    'the event is). It surfaces what deserves a look, not directional conviction: ' +
    'scoring happens later, after a symbol is promoted to a watchlist. ' +
    'The strip at the top shows how many symbols were filtered out so the app ' +
    'stays transparent about what it is ignoring.',
};
