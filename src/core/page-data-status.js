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
  'trading-strategies': { status: 'live', source: 'DB (seed data)' },
  'mt5-trading': { status: 'live', source: 'MT5 Bridge' },
  'calculators': { status: 'mock', note: 'Client-side only' },
  'portfolio-overview': { status: 'live', source: 'Alpaca + DB' },
  'trade-history': { status: 'live', source: 'DB' },
  'positions-monitor': { status: 'live', source: 'Alpaca + MT5' },
  'trade-journal': { status: 'mock', note: 'Local state only' },
  'mt5-connection-manager': { status: 'live', source: 'MT5 Bridge' },
  'accounts-dashboard': { status: 'partial', source: 'Trading212 placeholder' },

  // ── Scoring ──
  'directives-manager': { status: 'live', source: 'DB + Directive Registry' },
  'scoring-overview': { status: 'live', source: 'DB + Directive Registry' },
  'configure-directives': { status: 'live', source: 'DB' },
  'directives-status': { status: 'live', source: 'DB' },
  'sees-live-stack': { status: 'live', source: 'DB + Directive Engine' },
  'sees-arena': { status: 'live', source: 'Multi-stack comparison' },
  'predictive-sees': { status: 'live', source: 'Directional bias engine' },
  'signals-workbench': { status: 'live', source: 'SEES Diagnostics' },
  'protocol-overview': { status: 'live', source: 'DB' },
  'create-protocols': { status: 'live', source: 'DB + Directive Registry' },
  'scoring-runs': { status: 'live', source: 'DB' },
  'scoring-activity-logs': { status: 'partial', source: 'Logs table (WIP)' },

  // ── Research ──
  'research-overview': { status: 'mock', note: 'Static content' },
  'symbols-browser': { status: 'live', source: 'DB + Providers' },
  'snapshots': { status: 'mock', note: 'Hardcoded NVDA candles' },
  'sector-rotation': { status: 'live', source: 'Finnhub sectors' },
  'fluff-detector': { status: 'live', source: 'News sentiment analysis' },
  'market-correlations': { status: 'live', source: 'Pearson correlation API' },
  'news-intel': { status: 'live', source: 'Finnhub + DB' },
  'earnings-calendar': { status: 'live', source: 'Finnhub earnings calendar' },
  'social-networks': { status: 'mock', note: 'Not yet integrated' },
  'price-forecast': { status: 'partial', source: 'Finnhub — price-target requires premium subscription' },
  'events-calendar': { status: 'mock', note: 'Not yet built' },
  'macro-monitor': { status: 'live', source: 'FRED + ECB adapters' },

  // ── Analysis ──
  'recently-analysed-symbols': { status: 'partial', source: 'Some cached data' },
  'support-resistance': { status: 'live', source: 'Indicators module' },
  'volatility-analysis': { status: 'live', source: 'Indicators module' },
  'technical-indicators': { status: 'live', source: 'Indicators module' },
  'pattern-scanner': { status: 'mock', note: 'Random pattern data' },
  'chart-comparison': { status: 'mock', note: 'Not yet built' },
  'analyse-symbol': { status: 'live', source: 'Scoring + Indicators API' },

  // ── Data ──
  'data-landing': { status: 'mock', note: 'Static overview' },
  'sources': { status: 'live', source: 'Provider registry' },
  'import-jobs': { status: 'live', source: 'DB import runs' },
  'data-elements': { status: 'live', source: 'DB' },
  'decoder': { status: 'mock', note: 'Not yet built' },
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
  'create-watchlist': { status: 'mock', note: 'Auth-dependent (Q152)' },
  'add-symbol': { status: 'live', source: 'DB' },

  // ── Automation ──
  'automation-dashboard': { status: 'partial', source: 'Dashboard + mock queue' },
  'execution-queue': { status: 'live', source: 'DB execution queue' },
  'automation-rules': { status: 'live', source: 'DB' },
  'alert-center': { status: 'live', source: 'Alert system + DB' },

  // ── Development ──
  'architecture-framework': { status: 'live', source: 'Static architecture data' },
  'diagrams': { status: 'live', source: 'Generated diagrams' },
  'assets': { status: 'mock', note: 'Static listing' },
  'workflow-wizards': { status: 'mock', note: 'Not yet built' },
  'theme-lab-container': { status: 'live', source: 'Self-contained demo' },
  'theme-lab-popover': { status: 'live', source: 'Self-contained demo' },
  'algorithm-lab': { status: 'live', source: 'Directive scoring logs' },
  'backtest': { status: 'live', source: 'Backtest engine + DB' },
  'performance-lab': { status: 'live', source: 'Protocol metrics' },

  // ── Training ──
  'candle-patterns': { status: 'live', source: 'Interactive training' },
  'candle-patterns-guide': { status: 'live', source: 'Pattern reference' },
  'order-testing': { status: 'live', source: 'MT5 demo account' },
  'mt5-demo-trading': { status: 'live', source: 'MT5 Bridge demo' },

  // ── Status ──
  'status': { status: 'live', source: 'System health API' },
  'server-controls': { status: 'live', source: 'Intranet task runner' },
  'mt5-status': { status: 'live', source: 'MT5 Bridge diagnostics' },
  'platform-api-management': { status: 'mock', note: 'Not yet built' },
  'platform-comparisons': { status: 'live', source: 'Provider comparison API' },
  'platform-api-efficiency': { status: 'mock', note: 'Not yet built' },
  'platform-switches': { status: 'mock', note: 'Not yet built' },
  'risk-controls': { status: 'live', source: 'Risk module + DB' },
  'security': { status: 'mock', note: 'Auth-dependent (Q152)' },
  'analytics': { status: 'live', source: 'Analytics pipeline' },
  'audit-log': { status: 'mock', note: 'Not yet built' },
  'setup': { status: 'live', source: 'Setup checklist' },
  'capability-map': { status: 'live', source: 'Auto-generated from registries' },

  // ── Lab ──
  'lab': { status: 'live', source: 'Self-contained sandbox' },
  'lab-landing': { status: 'live', source: 'Static content' },
  'feature-lab': { status: 'live', source: 'Self-contained demos' },
  'theme-lab': { status: 'live', source: 'Self-contained demos' },
  'theme-lab-motion': { status: 'live', source: 'Self-contained demos' },
  'theme-lab-transitions': { status: 'live', source: 'View Transitions API' },
  'theme-lab-scroll': { status: 'live', source: 'Scroll animations demo' },
  'component-lab': { status: 'live', source: 'Self-contained showcase' },

  // ── Settings ──
  'settings': { status: 'live', source: 'Zustand store + localStorage' },
  'settings-database': { status: 'partial', source: 'Schema info, no admin UI' },
  'settings-education': { status: 'mock', note: 'Not yet built' },
  'theme-packs': { status: 'live', source: 'Theme system + CSS vars' },
  'user-preferences': { status: 'live', source: 'Zustand + localStorage' },
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
