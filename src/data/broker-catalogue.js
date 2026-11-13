/**
 * broker-catalogue.js — the USER-FACING broker directory.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ──────────────────────────────────────────
 * This is REFERENCE DATA: which brokers exist, where they operate, how they charge, whether
 * they expose an API, and how far TCS supports them. It is deliberately SEPARATE from
 * `GET /api/brokers/status`, which answers "what can this adapter do RIGHT NOW and is it up".
 *
 *   this file  → static, changes when a broker changes its terms
 *   the API    → live, changes every request
 *
 * The page joins them by `id`. A broker here with no API row is one TCS has not wired yet —
 * which is the normal case for most of this list, and is shown as such rather than hidden.
 *
 * ── WHY THE SUPPORT LEVEL IS A SEPARATE FIELD ─────────────────────────────────
 * The owner's bar for "TCS supports broker X" is *reading the account and forming portfolio
 * views*, NOT placing an order. So `tcsSupport` records the level reached, and the UI must
 * render the level rather than a yes/no. A brand-new integration that can read balances is a
 * real, publishable capability — calling it "not supported" because it cannot trade yet would
 * throw away the thing being built.
 *
 * ── ⚠️ HONESTY ABOUT FEES AND API DEPTH ──────────────────────────────────────
 * `feeModel` names the SHAPE of the charging, never a rate. Rates change without notice and a
 * stale "0.1%" in a public table is a false claim shown to a stranger. `feesVerified` marks
 * the ones actually checked against the broker's own documentation — the rest read as
 * "check the broker" on the page, which is true, rather than a number that is probably right.
 *
 * Same for `apiVerified`: only set when the broker's docs were read. `apiNote` carries what
 * was actually observed.
 *
 * ── ⚠️ AFFILIATE LINKS ───────────────────────────────────────────────────────
 * Owner instruction 2026-11-13: affiliate links are HARDCODED here, and that is accepted.
 * What must NOT be written into a GitHub issue is the *strategy* of earning a living from
 * them. So: the mechanism lives in this file, the reasoning lives nowhere public. Leave
 * `affiliateUrl` null rather than guessing a tag — a broken affiliate link silently pays
 * nobody, and a WRONG one pays a stranger.
 */

/** How far TCS supports a broker. Ordered least → most capable. */
export const TCS_SUPPORT = {
  NONE: 'none',
  PLANNED: 'planned',
  PORTFOLIO: 'portfolio',
  TRADING: 'trading',
};

export const TCS_SUPPORT_LABEL = {
  [TCS_SUPPORT.NONE]: 'Not yet',
  [TCS_SUPPORT.PLANNED]: 'Planned',
  [TCS_SUPPORT.PORTFOLIO]: 'Portfolio read',
  [TCS_SUPPORT.TRADING]: 'Trading',
};

/** Region codes → what a UK user needs to know before they can open an account there. */
export const REGION_LABEL = {
  UK: 'UK',
  EU: 'Europe',
  US: 'US',
  GLOBAL: 'Global',
};

/**
 * `id` MUST match an adapter id in `providers.module.ts` wherever one exists, because that is
 * the join key to `GET /api/brokers/status`. A broker with no adapter keeps an id of its own
 * and simply never joins.
 */
export const BROKER_CATALOGUE = [
  {
    id: 'mt5',
    name: 'MetaTrader 5 (via your broker)',
    website: 'https://www.metatrader5.com',
    affiliateUrl: null,
    regions: ['GLOBAL'],
    feeModel: 'Spread + commission set by the MT5 broker, not by MetaQuotes',
    feesVerified: true,
    tradingTypes: ['Forex', 'CFD', 'Indices', 'Commodities', 'Crypto', 'Shares'],
    api: 'Bridge',
    apiVerified: true,
    apiNote: 'No cloud API. TCS drives it through a local Python bridge on ports 5000/5001.',
    tcsSupport: TCS_SUPPORT.TRADING,
    note: 'The only venue where TCS can currently move a stop after entry (#1260).',
  },
  {
    id: 'capital.com',
    name: 'Capital.com',
    website: 'https://capital.com',
    affiliateUrl: null,
    regions: ['UK', 'EU'],
    feeModel: 'Spread only on CFDs; no commission on share CFDs',
    feesVerified: false,
    tradingTypes: ['CFD', 'Forex', 'Indices', 'Commodities', 'Crypto', 'Shares'],
    api: 'REST',
    apiVerified: true,
    apiNote: 'Session auth (CST + X-SECURITY-TOKEN). Orders can carry stopLevel/limitLevel at placement.',
    tcsSupport: TCS_SUPPORT.TRADING,
    note: 'Can place orders with SL/TP attached, but cannot move a stop afterwards (#1260).',
  },
  {
    id: 'trading212',
    name: 'Trading 212',
    website: 'https://www.trading212.com',
    affiliateUrl: null,
    regions: ['UK', 'EU'],
    feeModel: 'Zero commission on Invest and ISA; FX fee applies',
    feesVerified: false,
    tradingTypes: ['Shares', 'ETFs', 'CFD (separate account)'],
    api: 'REST',
    apiVerified: true,
    apiNote:
      'Docs state the public API is "enabled and usable only for Invest and Stocks ISA" — so the ' +
      'CFD account has no API. Market orders only; the adapter drops SL/TP.',
    tcsSupport: TCS_SUPPORT.PORTFOLIO,
    note: 'Order placement is gated off in TCS. Portfolio read only.',
  },
  {
    id: 'interactive-brokers',
    name: 'Interactive Brokers',
    website: 'https://www.interactivebrokers.co.uk',
    affiliateUrl: null,
    regions: ['UK', 'EU', 'US', 'GLOBAL'],
    feeModel: 'Commission per trade plus market-data subscriptions',
    feesVerified: false,
    tradingTypes: ['Shares', 'Options', 'Futures', 'Forex', 'Bonds', 'Funds'],
    api: 'TWS / Client Portal',
    apiVerified: false,
    apiNote: 'Needs a locally running gateway or a Client Portal app; not a plain REST key.',
    tcsSupport: TCS_SUPPORT.NONE,
    note:
      '⚠️ The adapter is a MOCK: placeOrder logs "no real execution" and returns success. ' +
      'It must not be presented as a working integration.',
  },
  {
    id: 'oanda',
    name: 'OANDA',
    website: 'https://www.oanda.com/uk-en/',
    affiliateUrl: null,
    regions: ['UK', 'EU', 'US'],
    feeModel: 'Spread only (core pricing) or spread + commission (premium)',
    feesVerified: false,
    tradingTypes: ['Forex', 'Indices', 'Commodities', 'Crypto'],
    api: 'REST v20',
    apiVerified: true,
    apiNote:
      'Docs state a Trade carries "the full representation of the Trade\'s dependent Orders", ' +
      'including trailingStopLossOrder — so stop management is answerable from the API.',
    tcsSupport: TCS_SUPPORT.PLANNED,
    note: 'Best next candidate: trailing stops are documented, which MT5-only stop handling needs.',
  },
  {
    id: 'ig',
    name: 'IG',
    website: 'https://www.ig.com/uk',
    affiliateUrl: null,
    regions: ['UK', 'EU'],
    feeModel: 'Spread on CFDs; commission on share dealing',
    feesVerified: false,
    tradingTypes: ['CFD', 'Spread bet', 'Forex', 'Indices', 'Commodities', 'Shares'],
    api: 'REST + streaming',
    apiVerified: false,
    apiNote: 'Public REST and Streaming API exist; depth not yet verified by this project.',
    tcsSupport: TCS_SUPPORT.PLANNED,
    note: 'Large UK CFD venue; spread betting is UK-only and tax-relevant.',
  },
  {
    id: 'cmc-markets',
    name: 'CMC Markets',
    website: 'https://www.cmcmarkets.com/en-gb',
    affiliateUrl: null,
    regions: ['UK', 'EU'],
    feeModel: 'Spread on CFDs; commission on share dealing',
    feesVerified: false,
    tradingTypes: ['CFD', 'Spread bet', 'Forex', 'Indices', 'Commodities', 'Shares'],
    api: 'REST',
    apiVerified: false,
    apiNote: 'Public API exists; depth not yet verified by this project.',
    tcsSupport: TCS_SUPPORT.PLANNED,
  },
  {
    id: 'saxo',
    name: 'Saxo Bank',
    website: 'https://www.home.saxo/en-gb',
    affiliateUrl: null,
    regions: ['UK', 'EU', 'GLOBAL'],
    feeModel: 'Commission + spread depending on instrument class',
    feesVerified: false,
    tradingTypes: ['Shares', 'CFD', 'Forex', 'Options', 'Futures', 'Bonds', 'Funds'],
    api: 'REST (OpenAPI)',
    apiVerified: false,
    apiNote: 'Well-documented OpenAPI; depth not yet verified by this project.',
    tcsSupport: TCS_SUPPORT.PLANNED,
    note: 'Broadest instrument range of the UK-available candidates.',
  },
  {
    id: 'xtb',
    name: 'XTB',
    website: 'https://www.xtb.com/en',
    affiliateUrl: null,
    regions: ['UK', 'EU'],
    feeModel: 'Zero commission on stocks/ETFs up to a monthly turnover; spread on CFDs',
    feesVerified: false,
    tradingTypes: ['Shares', 'ETFs', 'CFD', 'Forex', 'Indices', 'Commodities'],
    api: 'xAPI',
    apiVerified: false,
    apiNote: 'xAPI exists; depth not yet verified by this project.',
    tcsSupport: TCS_SUPPORT.PLANNED,
  },
  {
    id: 'etoro',
    name: 'eToro',
    website: 'https://www.etoro.com/en-gb/',
    affiliateUrl: null,
    regions: ['UK', 'EU', 'GLOBAL'],
    feeModel: 'Spread on CFDs; zero commission on stocks for some regions',
    feesVerified: false,
    tradingTypes: ['Shares', 'ETFs', 'CFD', 'Crypto'],
    api: 'Limited',
    apiVerified: false,
    apiNote: 'Public API is limited and partner-gated; depth not verified by this project.',
    tcsSupport: TCS_SUPPORT.PLANNED,
  },
  {
    id: 'alpaca',
    name: 'Alpaca',
    website: 'https://alpaca.markets',
    affiliateUrl: null,
    regions: ['US'],
    feeModel: 'Commission-free US equities',
    feesVerified: false,
    tradingTypes: ['US shares', 'ETFs', 'Options', 'Crypto'],
    api: 'REST + streaming',
    apiVerified: false,
    apiNote: 'Registered in TCS with quotes/candles only — no order methods implemented.',
    tcsSupport: TCS_SUPPORT.NONE,
    note: 'US-only; not available to a UK retail account for equities.',
  },
  {
    id: 'binance',
    name: 'Binance',
    website: 'https://www.binance.com',
    affiliateUrl: null,
    regions: ['GLOBAL'],
    feeModel: 'Maker/taker commission per trade',
    feesVerified: false,
    tradingTypes: ['Crypto spot', 'Crypto derivatives'],
    api: 'REST + WebSocket',
    apiVerified: false,
    apiNote: 'Registered in TCS with quotes only — no order methods implemented.',
    tcsSupport: TCS_SUPPORT.NONE,
    note: 'Not FCA-regulated; unauthorised for UK retail derivatives.',
  },
];

/** Lookup for the page join. Built once — the list is static. */
export const BROKER_CATALOGUE_BY_ID = new Map(BROKER_CATALOGUE.map((b) => [b.id, b]));
