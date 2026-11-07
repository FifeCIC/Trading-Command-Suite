/**
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0 · https://github.com/FifeCIC/Trading-Command-Suite
 *
 * Experience Level Matrix
 * =======================
 * Defines what's visible/available at each experience level.
 *
 * Levels: beginner | experienced | expert
 *
 * Each feature entry maps to a boolean or control value per level.
 * `true` = visible/enabled, `false` = hidden/disabled.
 *
 * The matrix drives:
 *   - Sidebar nav filtering (hide entire views)
 *   - Feature gating within views (hide sections/buttons)
 *   - Default protocol selection
 *   - Automation mode availability
 */

export const EXPERIENCE_LEVELS = ['beginner', 'experienced', 'expert'];

/**
 * ── PLANNED — STRATEGY UNLOCKING BY PRACTICE (owner request, 2026-11-07) ───────────────────────
 *
 * Owner, Trading walkthrough on `/trading/strategy-library`:
 *
 *   > "I also want an update to the user progression system - strategies will be unlocked over time
 *   >  in-line with what the user needs to have practiced first, this is low priority though so just
 *   >  do the update and make it clear that it is only going to be implemented when we have strong
 *   >  profiting strategies"
 *
 * ⚠️ DELIBERATELY NOT IMPLEMENTED. This is the intended shape recorded where the level matrix
 * lives, so the next person meets the requirement before they touch gating — not a mechanism that
 * runs today.
 *
 * | | |
 * |---|---|
 * | **What** | The Strategy Library unlocks strategies progressively, keyed to behaviour the user has actually practised, rather than to a settings toggle. |
 * | **Blocked on** | **There are no proven profitable strategies yet.** Gating a library on performance is meaningless until the library contains something worth unlocking — and it would ship a progression wall in front of unvalidated content. |
 * | **Not the same thing** | `EXPERIENCE_MATRIX.nav` below hides whole PAGES by declared level. This proposal gates CONTENT WITHIN one page by demonstrated practice. Two different axes; do not implement this by adding strategy ids to the nav matrix. |
 *
 * ⚠️ **The three states must stay distinct when it is built** (`development-status` §7): *locked —
 * not yet practised*, *available*, and *cannot judge — the performance evidence is too thin to
 * justify a lock* are three different answers. Collapsing "we do not know yet" into "locked" would
 * hide content on the strength of a missing measurement.
 *
 * ⚠️ **It must not be a paywall.** A separate decision already exists that Trading Plans and Bot
 * Comparison may become MEMBER-only pages; strategy unlocking is a PRACTICE gate, not an
 * entitlement, and the two must not be conflated (`hidden-views.js` — `member` vs `withheld`).
 *
 * Filed: see the Strategy Library progression note in the Trading walkthrough issue trail. The
 * precondition — a strategy with a demonstrated profitable record — has no owner yet.
 */

export const EXPERIENCE_MATRIX = {
  // ── Navigation: entire sidebar pages ──────────────
  // ⚠️ ADMISSION RULE FOR `beginner: false` (2026-11-03): a page earns it when the owner's own UI
  // score is ≤3 out of 10 AND he did not mark it high-importance in the Page Walkthrough. A weak score
  // says "this page needs work"; an explicit IMPORTANCE OF H says "you still need it", and hiding one
  // of those is a fix avoided rather than a first impression protected. That is why `market-context`
  // (score 2, importance H), `dual-protocol-inspector` (3, H) and `trade-journal` (3, H) are NOT in
  // this list despite scoring low — they need improving, not hiding.
  // ⚠️ These are LEVEL-scoped, never withheld: the owner's `hide: false` keeps stay intact, and an
  // Expert install still sees every one of them.
  nav: {
    // ⚠️ ADDED 2026-11-03 from the owner's own Page Walkthrough scores — all four are pages he also
    // marked `hide: false`, so withholding them outright would have overruled a decision he made
    // deliberately. Level-scoping is the compromise: a first-time reader does not meet them, and an
    // Expert install keeps every one.
    'stock-investigation':   { beginner: false, experienced: true, expert: true },  // score 1/10, medium
    'personal-finances':     { beginner: false, experienced: true, expert: true },  // score 1/10, medium
    'trading-styles':        { beginner: false, experienced: true, expert: true },  // score 2/10, medium
    'position-lifecycle':    { beginner: false, experienced: true, expert: true },  // score 3/10, medium
    // Trading
    'market-context':        { beginner: true,  experienced: true,  expert: true },
    'positions-monitor':     { beginner: true,  experienced: true,  expert: true },
    'strategy-comparison':   { beginner: false, experienced: true,  expert: true },
    'trade-journal':         { beginner: true,  experienced: true,  expert: true },
    'trading-plans':         { beginner: false, experienced: true,  expert: true },
    'calculators':           { beginner: true,  experienced: true,  expert: true },
    'accounts-dashboard':    { beginner: true,  experienced: true,  expert: true },
    // Scoring
    'directives-registry':    { beginner: false, experienced: true,  expert: true },
    'configure-directives':  { beginner: false, experienced: false, expert: true },
    // ── DECISION (2026-11-04) ──
    // WHAT:      `live-ordering-stack` (the Ladder) is visible at EVERY level.
    // WHY:       It is the only entry in the Scoring rail that was gated — `ab-ladder`,
    //            `symbols-ladder` and `singles-monitor` are undeclared, and an undeclared id is
    //            visible at every level (`isNavVisible` returns true). So the one page that DEFINES
    //            the area was the only one a non-expert could not reach: the owner reported it as
    //            "the Scoring area is missing a page: the main ladder". A gate that hides the
    //            subject of its own menu is a defect, not curation.
    // INSTEAD OF: `{ beginner: false, experienced: false, expert: true }` — expert only, added
    //            2026-11-03 from the Page Walkthrough score. A weak score says "this page needs
    //            work"; it does not say "remove the area's front door".
    // REVERSE BY: Restoring the expert-only triple above.
    'live-ordering-stack':   { beginner: true,  experienced: true,  expert: true },
    'sees-advanced':         { beginner: false, experienced: false, expert: true },
    'exit-signals':          { beginner: false, experienced: true,  expert: true },
    'sees-arena':            { beginner: false, experienced: false, expert: true },
    'protocols':             { beginner: false, experienced: true,  expert: true },
    'create-protocols':      { beginner: false, experienced: false, expert: true },
    'scoring-runs':          { beginner: false, experienced: true,  expert: true },
    'scoring-activity-logs': { beginner: false, experienced: true,  expert: true },
    // Research
    'research-notes':        { beginner: true,  experienced: true,  expert: true },
    'symbols-browser':       { beginner: true,  experienced: true,  expert: true },
    'screener':              { beginner: true,  experienced: true,  expert: true },
    'sector-rotation':       { beginner: false, experienced: false, expert: true },
    'market-correlations':   { beginner: false, experienced: false, expert: true },
    'news-intel':            { beginner: true,  experienced: true,  expert: true },
    'gap-scanner':           { beginner: false, experienced: true,  expert: true },
    'earnings-calendar':     { beginner: true,  experienced: true,  expert: true },
    'social-networks':       { beginner: false, experienced: false, expert: true },
    'price-forecast':        { beginner: false, experienced: true,  expert: true },
    'events-calendar':       { beginner: true,  experienced: true,  expert: true },
    'macro-monitor':         { beginner: false, experienced: true,  expert: true },
    // Analysis
    'recently-analysed-symbols':  { beginner: false, experienced: true,  expert: true },
    'support-resistance':         { beginner: true,  experienced: true,  expert: true },
    'volatility-analysis':        { beginner: false, experienced: true,  expert: true },
    'technical-indicators':       { beginner: false, experienced: true,  expert: true },
    'pattern-scanner':            { beginner: false, experienced: true,  expert: true },
    'chart-comparison':           { beginner: false, experienced: true,  expert: true },
    'analyse-symbol':             { beginner: true,  experienced: true,  expert: true },
    'seasonality-heatmap':        { beginner: false, experienced: false, expert: true },
    // Data
    'data-landing':          { beginner: false, experienced: true,  expert: true },
    'sources':               { beginner: false, experienced: true,  expert: true },
    'provider-health':       { beginner: false, experienced: true,  expert: true },
    'import-jobs':           { beginner: false, experienced: false, expert: true },
    'data-elements':         { beginner: false, experienced: false, expert: true },
    // ── DECISION (2026-11-04) ──
    // WHAT:      `backtest-data` is visible at EVERY level.
    // WHY:       Both of its siblings in this same Lab block are already `true` at every level, and
    //            for a stated reason: `backtest-runs` — "an entry point to the results is never
    //            hidden behind an experience setting" — and `current-strategy` — "it must not be
    //            hidden behind an experience setting". The Data inventory is the third entry point of
    //            that same suite, so gating it expert-only made the Lab's own rule apply to two of
    //            three. `hidden-views.js` also names `/lab/backtest*` as deliberately NOT withheld.
    //            The owner reported it as "the Backtesting Data page in the Lab area" missing.
    // INSTEAD OF: `{ beginner: false, experienced: false, expert: true }`, added 2026-11-03.
    // REVERSE BY: Restoring the expert-only triple above.
    'backtest-data':         { beginner: true,  experienced: true,  expert: true },
  // Stored-run review is the same audience as the data inventory: it is for finding out what changed
  // between measurements, which only matters once you are iterating on one. Visible to every level so
  // an entry point to the results is never hidden behind an experience setting.
  'backtest-runs':         { beginner: true, experienced: true, expert: true },
  // The A/B comparison of ONE strategy (2026-11-04). Same audience as stored-run review, and for the
  // same reason: it is where you find out whether a change helped, so it must not be hidden behind an
  // experience setting.
  'current-strategy':      { beginner: true, experienced: true, expert: true },
    'decoder':               { beginner: false, experienced: false, expert: true },
    'database-tables':       { beginner: false, experienced: false, expert: true },
    'api-activity':          { beginner: false, experienced: false, expert: true },
    'api-endpoints':         { beginner: false, experienced: false, expert: true },
    'transient-caches':      { beginner: false, experienced: false, expert: true },
    'create-source':         { beginner: false, experienced: false, expert: true },
    'api-keys':              { beginner: false, experienced: false, expert: true },
    // Watchlists
    'watchlists':            { beginner: true,  experienced: true,  expert: true },
    // Automation
    'automation-dashboard':  { beginner: false, experienced: true,  expert: true },
    'speed-scanner':         { beginner: false, experienced: true,  expert: true },
    'execution-queue':       { beginner: false, experienced: false, expert: true },
    'trade-rules':           { beginner: false, experienced: false, expert: true },
    'alerts':                { beginner: true,  experienced: true,  expert: true },
    // Planner
    'objectives':            { beginner: true,  experienced: true,  expert: true },
    'styles':                { beginner: false, experienced: true,  expert: true },
    'allocations':           { beginner: false, experienced: true,  expert: true },
    'finances':              { beginner: true,  experienced: true,  expert: true },
    // Status
    'status':                { beginner: true,  experienced: true,  expert: true },
    'system-health':         { beginner: false, experienced: true,  expert: true },
    'risk':                  { beginner: true,  experienced: true,  expert: true },
    // Builder
    'architecture-framework': { beginner: false, experienced: false, expert: true },
    'capability-map':         { beginner: false, experienced: false, expert: true },
    'pipeline-graph-lab':     { beginner: false, experienced: false, expert: true },
    'motion-lab':             { beginner: false, experienced: false, expert: true },
    'layout-guide':           { beginner: true,  experienced: true,  expert: true },
    'colour':                 { beginner: true,  experienced: true,  expert: true },
    'surfaces':               { beginner: true,  experienced: true,  expert: true },
    'data-display':           { beginner: true,  experienced: true,  expert: true },
  'info':                   { beginner: true,  experienced: true,  expert: true },
    'interactive':            { beginner: true,  experienced: true,  expert: true },
    'component-lab':          { beginner: false, experienced: false, expert: true },
    // Training
    'glossary':               { beginner: true,  experienced: true,  expert: true },
    'candle-patterns':       { beginner: true,  experienced: true,  expert: true },
    'order-testing':         { beginner: false, experienced: true,  expert: true },
    'mt5-demo':              { beginner: false, experienced: true,  expert: true },
    // Settings
    'settings':              { beginner: true,  experienced: true,  expert: true },
    // #617 split — all three are visible at every level ON PURPOSE. Two of them carry a
    // META.Stack layer kill switch, and a safety control that disappears at "beginner" is a
    // control the beginner cannot use to stop the thing that is running.
    'appearance':            { beginner: true,  experienced: true,  expert: true },
    'automation':            { beginner: true,  experienced: true,  expert: true },
    'scoring-settings':      { beginner: true,  experienced: true,  expert: true },
    'trading-settings':      { beginner: true,  experienced: true,  expert: true },
  },

  // ── Feature gating within views ────────────────────
  features: {
    // Trading Strategies page
    'strategy.autoMode':         { beginner: false, experienced: false, expert: true },
    'strategy.createNew':        { beginner: false, experienced: true,  expert: true },
    'strategy.editProtocol':     { beginner: false, experienced: false, expert: true },
    // Automation Dashboard
    'automation.startStop':      { beginner: false, experienced: true,  expert: true },
    'automation.emergencyStop':  { beginner: true,  experienced: true,  expert: true },
    'automation.configBroker':   { beginner: false, experienced: false, expert: true },
    // Scoring Workbench
    'signals.editProtocol':      { beginner: false, experienced: false, expert: true },
    'signals.customWatchlist':   { beginner: false, experienced: true,  expert: true },
    // Scoring Overview
    'scoring.protocolSelector':  { beginner: false, experienced: true,  expert: true },
    'scoring.debugLog':          { beginner: false, experienced: false, expert: true },
    // Market Context
    'market.preflightConfig':    { beginner: false, experienced: false, expert: true },
    // Positions Monitor
    'positions.modifySLTP':      { beginner: false, experienced: true,  expert: true },
    'positions.closeAll':        { beginner: false, experienced: true,  expert: true },
    // Backtest
    'backtest.advancedExecution': { beginner: false, experienced: false, expert: true },
    'backtest.walkForward':      { beginner: false, experienced: false, expert: true },
  },

  // ── Default protocol per level ─────────────────────
  defaultProtocol: {
    beginner:    'foundation-v1',    // Issue #274
    experienced: 'momentum-v1',      // Issue #275
    expert:      'advanced-v1',      // Issue #276
  },

  // ── Automation mode availability ───────────────────
  automationMode: {
    beginner:    ['manual'],                          // Log signals only
    experienced: ['manual', 'semi-auto'],             // Can queue trades
    expert:      ['manual', 'semi-auto', 'auto'],     // Full automation
  },

  // ── Default watchlists ─────────────────────────────
  defaultWatchlist: {
    beginner:    'foundation-watchlist',
    experienced: 'momentum-watchlist',
    expert:      'advanced-watchlist',
  },
};

/**
 * Get the current experience level from preferences.
 * @param {object} prefs — from usePreferences()
 * @returns {'beginner'|'experienced'|'expert'}
 */
export function getExperienceLevel(prefs) {
  return prefs?.experienceLevel || 'beginner';
}

/**
 * Check if a nav entry is visible at the current level.
 */
export function isNavVisible(navId, level) {
  return EXPERIENCE_MATRIX.nav[navId]?.[level] ?? true;
}

/**
 * Check if a feature is enabled at the current level.
 */
export function isFeatureEnabled(featureKey, level) {
  return EXPERIENCE_MATRIX.features[featureKey]?.[level] ?? true;
}

/**
 * Get the default protocol for the current level.
 */
export function getDefaultProtocol(level) {
  return EXPERIENCE_MATRIX.defaultProtocol[level] || EXPERIENCE_MATRIX.defaultProtocol.beginner;
}

/**
 * Get allowed automation modes for the current level.
 */
export function getAllowedModes(level) {
  return EXPERIENCE_MATRIX.automationMode[level] || EXPERIENCE_MATRIX.automationMode.beginner;
}
