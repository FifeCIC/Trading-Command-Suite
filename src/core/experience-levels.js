/**
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

export const EXPERIENCE_MATRIX = {
  // ── Navigation: entire sidebar pages ──────────────
  nav: {
    // Trading
    'market-context':        { beginner: true,  experienced: true,  expert: true },
    'positions-monitor':     { beginner: true,  experienced: true,  expert: true },
    'trading-strategies':    { beginner: false, experienced: true,  expert: true },
    'create-strategy':       { beginner: false, experienced: true,  expert: true },
    'strategy-comparison':   { beginner: false, experienced: true,  expert: true },
    'trade-journal':         { beginner: true,  experienced: true,  expert: true },
    'trading-plans':         { beginner: false, experienced: true,  expert: true },
    'calculators':           { beginner: true,  experienced: true,  expert: true },
    'accounts-dashboard':    { beginner: true,  experienced: true,  expert: true },
    // Scoring
    'directives-manager':    { beginner: false, experienced: true,  expert: true },
    'configure-directives':  { beginner: false, experienced: false, expert: true },
    'directives-status':     { beginner: false, experienced: true,  expert: true },
    'live-ordering-stack':   { beginner: false, experienced: false, expert: true },
    'sees-advanced':         { beginner: false, experienced: false, expert: true },
    'signals-workbench':     { beginner: false, experienced: true,  expert: true },
    'exit-signals':          { beginner: false, experienced: true,  expert: true },
    'sees-arena':            { beginner: false, experienced: false, expert: true },
    'protocols':             { beginner: false, experienced: true,  expert: true },
    'create-protocols':      { beginner: false, experienced: false, expert: true },
    'scoring-runs':          { beginner: false, experienced: true,  expert: true },
    'scoring-activity-logs': { beginner: false, experienced: true,  expert: true },
    // Research
    'research-overview':     { beginner: false, experienced: true,  expert: true },
    'symbols-browser':       { beginner: true,  experienced: true,  expert: true },
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
    'backtest-data':         { beginner: false, experienced: false, expert: true },
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
    'security':              { beginner: false, experienced: false, expert: true },
    // Builder
    'architecture-framework': { beginner: false, experienced: false, expert: true },
    'capability-map':         { beginner: false, experienced: false, expert: true },
    'pipeline-graph-lab':     { beginner: false, experienced: false, expert: true },
    'motion-lab':             { beginner: false, experienced: false, expert: true },
    'theme-lab':              { beginner: false, experienced: true,  expert: true },
    'component-lab':          { beginner: false, experienced: false, expert: true },
    // Training
    'candle-patterns':       { beginner: true,  experienced: true,  expert: true },
    'order-testing':         { beginner: false, experienced: true,  expert: true },
    'mt5-demo':              { beginner: false, experienced: true,  expert: true },
    // Settings
    'settings':              { beginner: true,  experienced: true,  expert: true },
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
    // Signals Workbench
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
