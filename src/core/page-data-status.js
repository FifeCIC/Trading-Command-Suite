/**
 * Page Data Status — tracks which pages use real API data vs mock/hardcoded data.
 *
 * Used by CapabilityMapPage to auto-generate data-readiness overview.
 *
 * Statuses:
 *   'live'     — uses real API/DB data
 *   'partial'  — some real data, some mock
 *   'mock'     — hardcoded or generated mock data
 *   'planned'  — not yet built
 */

export const PAGE_DATA_STATUS = {
  // ── Trading ──
  'trading-strategies': { status: 'live', source: 'DB (seed data, promoted from Legacy + sortable columns #566)' },
  'strategies-index': { status: 'removed', note: 'Merged into strategy-monitor (#560, 2026-08-04)' },
  'strategy-monitor': { status: 'live', source: 'DB (tabbed hub: overview/strategies/compare, #504)' },
  'strategy-builder': { status: 'removed', note: 'Scoring-strategy layer retired from the trading loop (2026-08-27) — use Protocol Builder + Create Strategy' },
  'strategy-create': { status: 'live', source: 'Tabbed creation: form + wizard (#504)' },
  'mt5-trading': { status: 'live', source: 'MT5 Bridge' },
  'calculators': { status: 'mock', note: 'Client-side only' },
  'stock-investigation': { status: 'live', source: '/api/research/investigations' },
  'portfolio-overview': { status: 'live', source: 'Alpaca + DB' },
  'portfolio-events': { status: 'live', source: '/api/portfolio/events' },
  'trade-history': { status: 'live', source: 'DB' },
  'positions-monitor': { status: 'live', source: 'Alpaca + MT5 (promoted from Legacy #565)' },
  'trade-journal': { status: 'live', source: '/api/journal/entries + stats' },
  'market-context': { status: 'live', source: '/api/trading/sessions/market-context (MarketContextService)' },
  'trading-plans': { status: 'live', source: 'DB (promoted from Legacy #568)' },
  'mt5-connection-manager': { status: 'live', source: 'MT5 Bridge' },
  'accounts-dashboard': { status: 'partial', source: 'Trading212 placeholder' },
  'speed-trading': { status: 'live', source: 'MT5 Bridge + speed-scan' },
  'btc-speed': { status: 'mock', note: 'Awaiting crypto-enabled MT5 broker' },
  'trading212-portfolio': { status: 'live', source: 'Trading212 API + gated scoring' },

  // ── Scoring ──
  'directives-registry': { status: 'live', source: 'DB + Directive Registry' },
  'scoring-overview': { status: 'live', source: 'DB + Directive Registry' },
  'configure-directives': { status: 'live', source: 'DB' },
  'sees-live-stack': { status: 'live', source: 'DB + Directive Engine' },
  'sees-arena': { status: 'live', source: 'Multi-stack comparison (compare-only, ladders detached #434)' },
  'predictive-sees': { status: 'live', source: 'Directional bias engine' },
  'exit-signals': { status: 'live', note: 'Exit urgency from portfolio scores + decisions' },
  'protocol-overview': { status: 'live', source: 'DB (48 protocols, consolidated stats + directive tooltips)' },
  'create-protocols': { status: 'live', source: 'DB + Directive Registry' },
  'protocol-builder': { status: 'live', source: 'DB + Directive Registry (#560 Protocol Builder — new route, builds protocols with direction/timeframe/groups)' },
  'scoring-runs': { status: 'removed', note: 'Duplicate of scoring-activity-logs (#558, 2026-08-04)' },
  'scoring-activity-logs': { status: 'live', source: '/api/scoring/runs (OutcomeTrackerService, @@index on Score.timestamp #444)' },

  // ── Research ──
  'research-notes': { status: 'live', source: 'DB (research_note) + /api/symbols registry + import refresh' },
  'symbols-browser': { status: 'live', source: 'DB + Providers' },
  'screener': { status: 'live', source: 'ScreenerHit catalysts (#682) + /api/screener/ranked' },
  'snapshots': { status: 'live', source: 'MarketData DB + MT5 Bridge import' },
  'sector-rotation': { status: 'live', source: 'Finnhub sectors' },
  'fluff-detector': { status: 'live', source: 'News sentiment analysis' },
  'market-correlations': { status: 'live', source: 'Pearson correlation API' },
  'news-intel': { status: 'live', source: 'Finnhub + DB' },
  'gap-scanner': { status: 'live', source: 'SEES gap-scanner directive via /api/scoring/ranked' },
  'social-networks': { status: 'live', note: 'Finnhub news sentiment — requires FINNHUB_API_KEY' },
  'price-forecast': { status: 'partial', source: 'Finnhub — price-target requires premium subscription' },
  'events-calendar': { status: 'live', source: 'Finnhub earnings + Timeline API' },
  'macro-monitor': { status: 'live', source: 'FRED + ECB adapters' },

  // ── Analysis ──
  'recently-analysed-symbols': { status: 'live', source: '/api/scoring/recently-analysed (Score snapshots)' },
  'support-resistance': { status: 'live', source: 'Indicators module' },
  'volatility-analysis': { status: 'live', source: 'Indicators module' },
  'technical-indicators': { status: 'live', source: 'Indicators module' },
  'pattern-scanner': { status: 'live', source: 'Market data candles + pattern detector' },
  'chart-comparison': { status: 'live', source: 'MT5 candles + SEES ranked scores' },
  'analyse-symbol': { status: 'live', source: 'Scoring + Indicators API' },
  'seasonality-heatmap': { status: 'live', source: '/api/speed/seasonality/:symbol (MT5 data)' },

  // ── Data ──
  'data-landing': { status: 'mock', note: 'Static overview' },
  'sources': { status: 'live', source: 'Provider registry' },
  'provider-health': { status: 'live', source: '/api/providers/health (30s refresh)' },
  'import-jobs': { status: 'live', source: 'DB import runs' },
  'data-elements': { status: 'live', source: 'DB' },
  'decoder': { status: 'live', source: '/api/decoder/parse + pattern-based analysis' },
  'database-tables': { status: 'live', source: 'Prisma schema + DB' },
  'imports-history': { status: 'live', source: 'DB' },
  'api-activity': { status: 'live', source: 'API activity logs' },
  'api-endpoints': { status: 'live', source: 'NestJS route discovery' },
  'transient-caches': { status: 'live', source: 'Cache monitor API' },
  'create-source': { status: 'mock', note: 'Form only, no backend' },
  'api-keys': { status: 'mock', note: 'Not yet built' },

  // ── Watchlists ──
  'active-symbols': { status: 'live', source: 'DB' },
  'user-watchlists': { status: 'mock', note: 'Auth-dependent (Q152)' },
  // create-watchlist → merged into user-watchlists (#301)
  'add-symbol': { status: 'live', source: 'DB' },

  // ── Automation ──
  'automation-dashboard': { status: 'live', source: 'Automation loop + activity feed (3s polling, 3-column layout)' },
  'automation-overview': { status: 'live', source: 'Automation status cards (health counter, MT5, providers #572)' },
  'execution-queue': { status: 'live', source: 'DB execution queue' },
  'automation-rules': { status: 'live', source: 'DB' },
  'alert-center': { status: 'live', source: 'Alert system + DB (Prisma Alert model, click navigation #442)' },

  // ── Development ──
  'architecture-framework': { status: 'live', source: 'Static architecture data' },
  'diagrams': { status: 'live', source: 'Generated diagrams' },
  'workflow-wizards': { status: 'mock', note: 'Not yet built' },
  'theme-lab-popover': { status: 'live', source: 'Self-contained demo' },
  'backtest': { status: 'live', source: 'Backtest engine + DB (moved to Training nav #466)' },
  'meta-stack-explorer': { status: 'live', source: 'Interactive pipeline visualization via POST /api/scoring/gated/batch' },
  'performance-lab': { status: 'partial', source: 'Trade table + MT5 bridge' },

  // ── Training ──
  'candle-patterns': { status: 'live', source: 'Interactive training' },
  'candle-patterns-guide': { status: 'live', source: 'Pattern reference' },
  'order-testing': { status: 'live', source: 'MT5 demo account' },
  'mt5-demo-trading': { status: 'live', source: 'MT5 Bridge demo' },

  // ── Status ──
  'status': { status: 'live', source: 'System health API' },
  'server-controls': { status: 'live', source: 'Intranet task runner' },
  'mt5-status': { status: 'live', source: 'MT5 Bridge diagnostics' },
  'platform-comparisons': { status: 'live', source: 'Provider comparison API' },
  'risk-controls': { status: 'live', source: 'Risk module + DB' },
  'analytics': { status: 'live', source: 'Analytics pipeline' },
  'setup': { status: 'live', source: 'GET /api/health/setup (first-run detection, SetupBanner component)' },
  'capability-map': { status: 'live', source: 'Auto-generated from registries' },

  // ── Lab ──
  'lab': { status: 'live', source: 'Self-contained sandbox' },
  'lab-landing': { status: 'live', source: 'Static content' },
  'daily-briefing': { status: 'live', source: '5 APIs (timeline, MT5, scoring, watchlists)' },
  'feature-lab': { status: 'live', source: 'Self-contained demos' },
  'theme-lab': { status: 'live', source: 'Self-contained demos' },
  'theme-lab-motion': { status: 'live', source: 'Self-contained demos' },
  'theme-lab-transitions': { status: 'live', source: 'View Transitions API' },
  'theme-lab-scroll': { status: 'live', source: 'Scroll animations demo' },
  'component-lab': { status: 'live', source: 'Self-contained showcase' },

  // ── Settings ──
  // #617 split the old single General page (13 sections) into one page per question:
  // Appearance (theme/display/tape), Trading (bots/defaults/risk), Scoring (thresholds),
  // Automation (loop/queue/inclusion). General keeps only non-layer plumbing.
  'settings': { status: 'live', source: 'Static infra info + /api/system/settings/health-checks' },
  'appearance': { status: 'live', source: 'Zustand theme store + localStorage preferences' },
  'scoring-settings': { status: 'live', source: '/api/scoring/gated/thresholds + /api/automation/layer' },
  'automation': { status: 'live', source: '/api/automation/status, /bot-queue, /rules, /layer' },
  'settings-database': { status: 'partial', source: 'Schema info, no admin UI' },
  'settings-education': { status: 'mock', note: 'Not yet built' },
  'theme-packs': { status: 'live', source: 'Theme system + CSS vars' },
  'user-preferences': { status: 'live', source: 'Zustand + localStorage' },
  'global-allocator': { status: 'live', source: '/api/diversification/*' },
  'symbol-focus': { status: 'live', source: '/api/symbols/:ticker/focus' },
  'ab-testing': { status: 'partial', source: 'Client-side comparison via POST /api/scoring/gated/batch' },
  'ai-costs': { status: 'partial', note: 'Frontend ready, backend pending' },
  'decision-trail': { status: 'partial', note: 'Frontend ready, depends on #350 Decision-Trail storage' },
  'health-check': { status: 'live', source: '/api/system/health-dashboard (6 diagnostic panels, 15s refresh)' },
  'commands': { status: 'live', source: 'Static CLI reference (27 commands across 6 categories)' },
};

/**
 * Compute summary counts from PAGE_DATA_STATUS.
 */
export function getPageDataSummary() {
  let live = 0, partial = 0, mock = 0, planned = 0;
  for (const entry of Object.values(PAGE_DATA_STATUS)) {
    switch (entry.status) {
      case 'live': live++; break;
      case 'partial': partial++; break;
      case 'mock': mock++; break;
      default: planned++; break;
    }
  }
  const total = live + partial + mock + planned;
  return { live, partial, mock, planned, total };
}
