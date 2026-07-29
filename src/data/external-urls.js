/**
 * External URL Registry — Single source of truth for ALL external URLs.
 *
 * Every URL the app links to or calls lives here. This enables:
 *  - Broken link checking (scripts/check-urls.mjs)
 *  - Easy affiliate link updates (change one URL, updates everywhere)
 *  - Security auditing (all outbound links in one place)
 *  - Environment-aware URLs (demo vs live per broker)
 *
 * @generated 2026-07-28 — extracted from hardcoded URLs across the codebase
 */

export const EXTERNAL_URLS = {
  // ═══ Brokers ═══════════════════════════════════════════════════

  brokers: {
    capitalCom: {
      demoApi: 'https://demo-api-capital.backend-capital.com',
      liveApi: 'https://api-capital.backend-capital.com',
      docs: 'https://capital.com/api/docs',
      signup: 'https://capital.com/signup',
      affiliate: 'https://capital.com/signup?ref=TCS',
    },
    trading212: {
      liveApi: 'https://live.trading212.com/api/v0',
      demoApi: 'https://demo.trading212.com/api/v0',
      docs: 'https://t212public-api-docs.redoc.ly',
      signup: 'https://www.trading212.com/invite',
      affiliate: 'https://www.trading212.com/invite/TCS',
    },
    mt5: {
      download: 'https://www.metatrader5.com/en/download',
      docs: 'https://www.mql5.com/en/docs',
    },
    alpaca: {
      paperApi: 'https://paper-api.alpaca.markets',
      liveApi: 'https://api.alpaca.markets',
      dashboard: 'https://app.alpaca.markets/paper/dashboard',
      docs: 'https://alpaca.markets/docs',
      signup: 'https://alpaca.markets/signup',
    },
    binance: {
      api: 'https://api.binance.com',
      docs: 'https://binance-docs.github.io/apidocs',
    },
  },

  // ═══ Data Providers ════════════════════════════════════════════

  providers: {
    finnhub: {
      api: 'https://finnhub.io/api/v1',
      register: 'https://finnhub.io/register',
      docs: 'https://finnhub.io/docs/api',
    },
    fmp: {
      api: 'https://financialmodelingprep.com/api/v3',
      register: 'https://financialmodelingprep.com',
      docs: 'https://financialmodelingprep.com/developer/docs',
    },
    alphaVantage: {
      api: 'https://www.alphavantage.co/query',
      register: 'https://www.alphavantage.co/support/#api-key',
      docs: 'https://www.alphavantage.co/documentation',
    },
    twelveData: {
      api: 'https://api.twelvedata.com',
      register: 'https://twelvedata.com/apikey',
      docs: 'https://twelvedata.com/docs',
    },
    polygon: {
      api: 'https://api.polygon.io',
      register: 'https://polygon.io/dashboard/signup',
      docs: 'https://polygon.io/docs/stocks',
    },
    yahooFinance: {
      api: 'https://query1.finance.yahoo.com',
      docs: 'https://www.yahoo.com/author/finance',
    },
    fred: {
      api: 'https://api.stlouisfed.org/fred',
      apiKeyDocs: 'https://fred.stlouisfed.org/docs/api/api_key.html',
    },
    ecb: {
      fxApi: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    },
  },

  // ═══ AI Services ══════════════════════════════════════════════

  ai: {
    deepseek: {
      api: 'https://api.deepseek.com/v1',
      platform: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/docs',
    },
  },

  // ═══ GitHub ═══════════════════════════════════════════════════

  github: {
    repo: 'https://github.com/FifeCIC/Trading-Command-Suite',
    issues: 'https://github.com/FifeCIC/Trading-Command-Suite/issues',
    knownGaps: 'https://github.com/FifeCIC/Trading-Command-Suite/issues?q=label%3Aknown-gap',
    revisionLog: 'https://github.com/FifeCIC/Trading-Command-Suite/issues?q=label%3Arevision-log+is%3Aclosed',
    issue172: 'https://github.com/FifeCIC/Trading-Command-Suite/issues/172',
    issue173: 'https://github.com/FifeCIC/Trading-Command-Suite/issues/173',
  },

  // ═══ External / Affiliate / Community ════════════════════════

  community: {
    buyMeACoffee: 'https://www.buymeacoffee.com/ryanbayne',
    motionDev: 'https://motion.dev',
    prismaDocs: 'https://pris.ly/d/connection-strings',
    prismaEnvVars: 'https://pris.ly/prisma-config-env-vars',
  },

  // ═══ Local Development ════════════════════════════════════════

  local: {
    vite: 'http://localhost:5173',
    nestjs: 'http://localhost:3201',
    mt5Bridge: 'http://localhost:5000',
    phpMyAdmin: 'http://localhost/phpmyadmin',
    intranet: 'http://localhost/intranet',
  },
};

/**
 * Resolve a broker API URL based on mode.
 * @param {'demo'|'live'} mode
 * @returns The API base URL for the given mode
 */
export function capitalComApiUrl(mode = 'demo') {
  return mode === 'live'
    ? EXTERNAL_URLS.brokers.capitalCom.liveApi
    : EXTERNAL_URLS.brokers.capitalCom.demoApi;
}

export function trading212ApiUrl(mode = 'demo') {
  return mode === 'live'
    ? EXTERNAL_URLS.brokers.trading212.liveApi
    : EXTERNAL_URLS.brokers.trading212.demoApi;
}

export function alpacaApiUrl(mode = 'paper') {
  return mode === 'live'
    ? EXTERNAL_URLS.brokers.alpaca.liveApi
    : EXTERNAL_URLS.brokers.alpaca.paperApi;
}

/**
 * Get all checkable URLs (excludes localhost, email, and purely informational URLs).
 * Used by the broken link checker script.
 */
export function getCheckableUrls() {
  const urls = [];

  // Flatten brokers
  for (const [broker, urls_] of Object.entries(EXTERNAL_URLS.brokers)) {
    for (const [key, url] of Object.entries(urls_)) {
      if (typeof url === 'string' && url.startsWith('https://')) {
        urls.push({ category: 'broker', name: `${broker}.${key}`, url });
      }
    }
  }

  // Flatten providers
  for (const [provider, urls_] of Object.entries(EXTERNAL_URLS.providers)) {
    for (const [key, url] of Object.entries(urls_)) {
      if (typeof url === 'string' && url.startsWith('https://')) {
        urls.push({ category: 'provider', name: `${provider}.${key}`, url });
      }
    }
  }

  // AI
  for (const [svc, urls_] of Object.entries(EXTERNAL_URLS.ai)) {
    for (const [key, url] of Object.entries(urls_)) {
      if (typeof url === 'string' && url.startsWith('https://')) {
        urls.push({ category: 'ai', name: `${svc}.${key}`, url });
      }
    }
  }

  // GitHub
  for (const [key, url] of Object.entries(EXTERNAL_URLS.github)) {
    if (typeof url === 'string' && url.startsWith('https://')) {
      urls.push({ category: 'github', name: key, url });
    }
  }

  // Community
  for (const [key, url] of Object.entries(EXTERNAL_URLS.community)) {
    if (typeof url === 'string' && url.startsWith('https://')) {
      urls.push({ category: 'community', name: key, url });
    }
  }

  return urls;
}
