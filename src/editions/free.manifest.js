/**
 * FREE EDITION MANIFEST — GENERATED FILE, DO NOT EDIT.
 *
 * Source of truth: the `tier` field on each entry in `src/core/view-meta.js`.
 * Regenerate with: node scripts/generate-free-manifest.cjs
 * Check freshness:  node scripts/generate-free-manifest.cjs --check
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3)
 *
 * 40 free · 80 premium · 120 total
 */
export const FREE_MANIFEST = {
  generatedFrom: 'src/core/view-meta.js',
  freeViews: [
    '/automation/alert-center',
    '/automation/automation-dashboard',
    '/automation/automation-rules',
    '/automation/execution-queue',
    '/dashboard',
    '/dashboard/dashboard',
    '/education/candle-patterns',
    '/education/candle-patterns-guide',
    '/education/glossary',
    '/education/settings-education',
    '/research/earnings-calendar',
    '/research/events-calendar',
    '/research/market-correlations',
    '/research/news-intel',
    '/research/recently-analysed-symbols',
    '/research/research-notes',
    '/research/screener',
    '/research/symbol',
    '/research/symbols-browser',
    '/settings/appearance',
    '/settings/risk-controls',
    '/settings/settings',
    '/settings/settings-education',
    '/settings/theme-packs',
    '/settings/trading-settings',
    '/settings/user-preferences',
    '/status/setup',
    '/trading/calculators',
    '/trading/market-context',
    '/trading/mt5-trading',
    '/trading/performance-lab',
    '/trading/positions-monitor',
    '/trading/symbol',
    '/trading/trade-journal',
    '/trading/trading-plans',
    '/trading/trading-settings',
    '/trading212/t212-isa',
    '/trading212/t212-portfolio',
    '/watchlists/active-symbols',
    '/watchlists/user-watchlists',
  ],
  // ⚠️ The premium PATH LIST is deliberately NOT emitted here (2026-09-23). This file is imported
  // by src/core/edition-nav.js, which the free bundle contains — so a premium route list here means
  // the free build ships the map of the app. Measured before the change: all 95 premium paths were
  // present as string literals in dist-free/assets/index-*.js. Only the COUNT stays; anything that
  // genuinely needs the premium list derives it from view-meta.js, which never ships.
  premiumCount: 80,
};

/** True when a view-meta key ships in the free edition. */
export function isFreeView(pathOrKey) {
  return FREE_MANIFEST.freeViews.includes(pathOrKey);
}
