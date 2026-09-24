/**
 * Free-edition view metadata — GENERATED FILE, DO NOT EDIT.
 *
 * Filtered copy of `src/core/view-meta.js` for the free edition.
 * Regenerate with: node scripts/generate-free-map.cjs
 * Check freshness:  node scripts/generate-free-map.cjs --check
 *
 * 43 of 136 entries — premium entries carry labels, source file paths and API endpoints, so leaving them in published the map
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3, §11.1)
 */

export const VIEW_META = {
  "/dashboard": {
    tier: "free",
    review: "pending",
    label: "Dashboard",
    file: "src/pages/DashboardPage.jsx",
    css: "src/pages/home-dashboard.css",
    api: [
      "GET /api/providers/mt5/diagnostics",
      "GET /api/providers/mt5/positions",
      "GET /api/scoring/ranked",
    ],
  },
  "/research/symbols-browser": {
    tier: "free",
    review: "approved",
    label: "Symbols Browser",
    file: "src/pages/SymbolsBrowserPage.jsx",
    css: "src/pages/symbols-browser.css",
    api: [
      "GET /api/symbols",
      "GET /api/market-data/freshness",
      "GET /api/symbols/:ticker/snapshot",
      "GET /api/symbols/positions",
    ],
  },
  "/research/screener": {
    tier: "free",
    review: "approved",
    label: "Screener",
    file: "src/pages/ScreenerPage.jsx",
    css: "src/pages/screener.css",
    api: [
      "GET /api/screener/ranked",
      "GET /api/screener/hits",
    ],
  },
  "/research/earnings-calendar": {
    tier: "free",
    review: "approved",
    label: "Earnings Calendar",
    file: "src/pages/EarningsCalendarPage.jsx",
    css: "src/pages/earnings-calendar.css",
    api: [
      "GET /api/research/earnings/calendar",
    ],
  },
  "/research/news-intel": {
    tier: "free",
    review: "approved",
    label: "News Intel",
    file: "src/pages/NewsIntelPage.jsx",
    css: "src/pages/news-intel.css",
    api: [
      "GET /api/news/feed",
      "GET /api/news/categories",
      "GET /api/news/sentiment-summary",
      "GET /api/news/import/last",
      "POST /api/news/import/run",
    ],
  },
  "/research/symbol": {
    tier: "free",
    review: "pending",
    label: "Symbol Detail",
    file: "src/pages/SymbolPage.jsx",
    css: "src/pages/symbol-page.css",
    api: [
      "GET /api/symbols/:ticker/focus",
      "GET /api/signals/envelope/:ticker?protocol=",
      "GET /api/symbols/:ticker/overview",
      "GET /api/earnings/symbol/:ticker",
      "GET /api/news/feed?symbol=:ticker&limit=5",
    ],
  },
  "/education/glossary": {
    tier: "free",
    review: "approved",
    label: "Glossary",
    file: "src/pages/GlossaryPage.jsx",
    css: "src/pages/glossary-page.css",
    api: [],
  },
  "/trading/market-context": {
    tier: "free",
    review: "approved",
    label: "Market Context",
    file: "src/pages/MarketContextPage.jsx",
    css: "src/pages/market-context.css",
    api: [
      "GET /api/trading/sessions/market-context",
      "GET /api/portfolio",
      "GET /api/scoring/runs",
    ],
  },
  "/trading/positions-monitor": {
    tier: "free",
    review: "approved",
    label: "Positions Monitor",
    file: "src/pages/PositionsMonitorPage.jsx",
    css: "src/pages/positions-monitor.css",
    api: [
      "GET /api/portfolio?source=mt5",
      "GET /api/portfolio?source=trading212",
    ],
  },
  "/trading/symbol": {
    tier: "free",
    review: "pending",
    label: "Symbol Detail",
    file: "src/pages/SymbolPage.jsx",
    css: "src/pages/symbol-page.css",
    api: [
      "GET /api/symbols/:ticker/focus",
      "GET /api/signals/envelope/:ticker?protocol=",
      "GET /api/symbols/:ticker/overview",
      "GET /api/earnings/symbol/:ticker",
      "GET /api/news/feed?symbol=:ticker&limit=5",
    ],
  },
  "/trading/trade-journal": {
    tier: "free",
    review: "approved",
    label: "Trade Journal",
    file: "src/pages/TradeJournalPage.jsx",
    css: "src/pages/trade-journal-page.css",
    api: [
      "GET /api/journal/entries",
      "GET /api/journal/stats",
    ],
  },
  "/trading/calculators": {
    tier: "free",
    review: "approved",
    label: "Calculators",
    file: "src/pages/CalculatorsPage.jsx",
    css: "src/pages/calculators.css",
    api: [],
  },
  "/trading/accounts-dashboard": {
    tier: "free",
    review: "approved",
    label: "Accounts Dashboard",
    file: "src/pages/AccountsDashboardPage.jsx",
    css: "src/pages/accounts-dashboard.css",
    api: [
      "GET /api/providers/mt5/accounts",
      "GET /api/portfolio/summary",
      "GET /api/isa/dashboard",
    ],
  },
  "/automation/automation-dashboard": {
    tier: "free",
    review: "approved",
    label: "Automation Dashboard",
    file: "src/pages/AutomationDashboardPage.jsx",
    css: "src/pages/automation-dashboard.css",
    api: [
      "GET /api/automation/status",
      "POST /api/automation/start",
      "POST /api/automation/stop",
    ],
  },
  "/automation/automation-rules": {
    tier: "free",
    review: "approved",
    label: "Automation Rules",
    file: "src/pages/AutomationRulesPage.jsx",
    css: "src/pages/automation-rules.css",
    api: [
      "GET /api/automation/rules",
    ],
  },
  "/automation/execution-queue": {
    tier: "free",
    review: "approved",
    label: "Execution Queue",
    file: "src/pages/ExecutionQueuePage.jsx",
    css: "src/pages/execution-queue.css",
    api: [
      "GET /api/automation/status",
      "GET /api/trading/mt5/positions",
    ],
  },
  "/automation/alert-center": {
    tier: "free",
    review: "approved",
    label: "Alert Center",
    file: "src/pages/AlertCenterPage.jsx",
    css: "src/pages/alert-center.css",
    api: [
      "GET /api/alerts",
      "GET /api/automation/status",
    ],
  },
  "/watchlists/active-symbols": {
    tier: "free",
    review: "approved",
    label: "Active Symbols",
    file: "src/pages/ActiveSymbolsPage.jsx",
    css: "src/pages/trading-platforms.css",
    api: [
      "GET /api/symbols",
      "GET /api/portfolio",
      "GET /api/directives",
    ],
  },
  "/watchlists/user-watchlists": {
    tier: "free",
    review: "approved",
    label: "Watchlists",
    file: "src/pages/UserWatchlistsPage.jsx",
    css: "src/pages/watchlists.css",
    api: [
      "GET /api/watchlists",
      "POST /api/watchlists",
    ],
  },
  "/trading/trading-plans": {
    tier: "free",
    review: "approved",
    label: "Trading Plans",
    file: "src/pages/TradingPlansPage.jsx",
    css: "src/pages/trading-plans-page.css",
    api: [],
  },
  "/trading/performance-lab": {
    tier: "free",
    review: "approved",
    label: "Trading Performance",
    file: "src/pages/PerformanceLabPage.jsx",
    css: "src/pages/performance-lab.css",
    api: [],
  },
  "/trading/trading-settings": {
    tier: "free",
    review: "approved",
    label: "Trading",
    file: "src/pages/TradingSettingsPage.jsx",
    css: "src/pages/settings.css",
    api: [
      "GET /api/signals/trade-defaults",
      "PUT /api/signals/trade-defaults",
      "GET /api/scoring/gated/thresholds",
      "GET /api/trading/strategies/risk-limits",
      "POST /api/automation/layer",
    ],
  },
  "/trading212/t212-portfolio": {
    tier: "free",
    review: "approved",
    label: "Portfolio",
    file: "src/pages/T212PortfolioPage.jsx",
    css: "src/pages/t212-portfolio.css",
    api: [],
  },
  "/trading212/t212-isa": {
    tier: "free",
    review: "approved",
    label: "Stocks ISA",
    file: "src/pages/T212ISAPage.jsx",
    css: "src/pages/t212-isa.css",
    api: [],
  },
  "/education/mt5-demo-trading": {
    tier: "free",
    review: "approved",
    label: "MT5 Demo Trading",
    file: "src/pages/Mt5TradingPage.jsx",
    css: "src/pages/mt5-trading-page.css",
    api: [],
  },
  "/education/candle-patterns": {
    tier: "free",
    review: "approved",
    label: "Pattern Detection",
    file: "src/pages/TrainingCandlePatternsPage.jsx",
    css: "src/pages/training-candle-patterns-page.css",
    api: [],
  },
  "/education/candle-patterns-guide": {
    tier: "free",
    review: "approved",
    label: "Candle Patterns",
    file: "src/pages/CandlePatternsGuidePage.jsx",
    css: "src/pages/candle-patterns-guide.css",
    api: [],
  },
  "/status/setup": {
    tier: "free",
    review: "pending",
    label: "Setup & Diagnostics",
    file: "src/pages/SetupWizardPage.jsx",
    css: "src/pages/setup-wizard.css",
    api: [],
  },
  "/development/mt5-trading": {
    tier: "free",
    review: "pending",
    label: "MT5 Trading (Lab)",
    file: "src/pages/Mt5TradingPage.jsx",
    css: "src/pages/mt5-trading-page.css",
    api: [],
  },
  "/settings/risk-controls": {
    tier: "free",
    review: "pending",
    label: "Risk Controls",
    file: "src/pages/RiskControlsPage.jsx",
    css: "src/pages/risk-controls.css",
    api: [],
  },
  "/settings/settings": {
    tier: "free",
    review: "pending",
    label: "General",
    file: "src/pages/SettingsPage.jsx",
    css: "src/pages/settings.css",
    api: [
      "GET /api/system/settings/health-checks",
      "PUT /api/system/settings/health-checks",
    ],
  },
  "/settings/settings-education": {
    tier: "free",
    review: "pending",
    label: "Education",
    file: "src/pages/SettingsEducationPage.jsx",
    css: "src/pages/settings-education.css",
    api: [],
  },
  "/settings/theme-packs": {
    tier: "free",
    review: "pending",
    label: "Theme Packs",
    file: "src/pages/ThemePage.jsx",
    css: "src/pages/theme-page.css",
    api: [],
  },
  "/settings/user-preferences": {
    tier: "free",
    review: "pending",
    label: "User Preferences",
    file: "src/pages/PreferenceLab.jsx",
    css: "src/pages/preference-lab.css",
    api: [],
  },
  "/settings/trading-settings": {
    tier: "free",
    review: "pending",
    label: "Trading",
    file: "src/pages/TradingSettingsPage.jsx",
    css: "src/pages/settings.css",
    api: [
      "GET /api/signals/trade-defaults",
      "PUT /api/signals/trade-defaults",
      "GET /api/scoring/gated/thresholds",
      "GET /api/trading/strategies/risk-limits",
      "POST /api/automation/layer",
    ],
  },
  "/settings/appearance": {
    tier: "free",
    review: "pending",
    label: "Appearance",
    file: "src/pages/AppearanceSettingsPage.jsx",
    css: "src/pages/settings.css",
    api: [],
  },
  "/dashboard/dashboard": {
    tier: "free",
    review: "approved",
    label: "Dashboard",
    file: "src/pages/DashboardPage.jsx",
    css: "src/pages/home-dashboard.css",
    api: [
      "GET /api/providers/mt5/diagnostics",
      "GET /api/providers/mt5/positions",
      "GET /api/scoring/ranked",
    ],
  },
  "/watchlists/add-symbol": {
    tier: "free",
    review: "approved",
    label: "Add Symbol",
    file: "src/pages/AddSymbolPage.jsx",
    css: "src/pages/add-symbol.css",
    api: [],
  },
  "/research/research-notes": {
    tier: "free",
    review: "approved",
    label: "Notes",
    file: "src/pages/ResearchNotesPage.jsx",
    css: "src/pages/research-notes.css",
    api: [
      "GET /api/research/notes",
      "POST /api/research/notes",
      "PUT /api/research/notes/reorder",
      "GET /api/symbols",
    ],
  },
  "/research/events-calendar": {
    tier: "free",
    review: "approved",
    label: "Events Calendar",
    file: "src/pages/EventsCalendarPage.jsx",
    css: "src/pages/events-calendar.css",
    api: [
      "GET /api/research/earnings/calendar",
      "GET /api/automation/timeline?lookahead=240",
      "GET /api/portfolio",
    ],
  },
  "/research/market-correlations": {
    tier: "free",
    review: "approved",
    label: "Market Correlations",
    file: "src/pages/MarketCorrelationsPage.jsx",
    css: "src/pages/market-correlations.css",
    api: [
      "GET /api/portfolio/correlation",
    ],
  },
  "/research/recently-analysed-symbols": {
    tier: "free",
    review: "approved",
    label: "Recently Analysed",
    file: "src/pages/RecentlyAnalysedSymbolsPage.jsx",
    css: "src/pages/recently-analysed.css",
    api: [
      "GET /api/scoring/recently-analysed?limit=50",
    ],
  },
  "/education/settings-education": {
    tier: "free",
    review: "approved",
    label: "Education Settings",
    file: "src/pages/SettingsEducationPage.jsx",
    css: "src/pages/settings.css",
    api: [],
  },
};


/** Resolve a URL path to the VIEW_META KEY (exact, then longest-prefix match), or null. */
export function getViewMetaKey(pathname) {
  // Try exact match first
  if (VIEW_META[pathname]) return pathname;

  // Try prefix match for sub-routes (e.g. /trading/strategy/123 → /trading/strategy)
  // Sort by route length descending so longer (more specific) routes match first
  const routes = Object.keys(VIEW_META).sort((a, b) => b.length - a.length);
  for (const route of routes) {
    if (pathname.startsWith(route + '/')) return route;
  }

  return null;
}

/** Get view metadata from current URL path */
export function getViewMeta(pathname) {
  const key = getViewMetaKey(pathname);
  return key ? VIEW_META[key] : null;
}

/** Format view metadata as a copyable string */
export function formatViewMeta(pathname) {
  const meta = getViewMeta(pathname);
  if (!meta) return `View: ${pathname}\n(No metadata registered for this route)`;

  return [
    `View:       ${meta.label}`,
    `Route:      ${pathname}`,
    `File:       ${meta.file}`,
    `CSS:        ${meta.css}`,
    `API:        ${meta.api.join(', ') || 'None'}`,
    `Component:  <${meta.label.replace(/\s+/g, '')} />`,
  ].join('\n');
}

export default VIEW_META;
