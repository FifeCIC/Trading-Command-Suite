/**
 * FocusedTranslator — maps technical/slug data to user-friendly language.
 *
 * Principles:
 *   - Slugs become titles: "forex-majors" → "FOREX Majors"
 *   - Protocol IDs become names: "mt5-technical-core-v1" → "Technical Core v1"
 *   - Raw numbers become interpretations: composite 72 → "Strong Buy"
 *   - Technical paths become human descriptions
 *   - Hover reveals the underlying technical value
 *   - Prefers live API data over hardcoded maps, with slug→title as final fallback
 */

/** Convert a kebab/snake-case slug to a human-readable title */
function slugToTitle(slug) {
  if (!slug) return 'Unknown';
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .replace(/\b(Mt5|Btc|Eth|Xrp|Doge|Usd|Cad|Jpy|Gbp|Eur|Aud|Nzd|Chf|Xau|Rsi|Macd|Atr|Vwap|Ema|Sma|Sl|Tp|Pnl)\b/gi,
      function (m) { return m.toUpperCase(); });
}

/** Generate a default description from a slug */
function defaultDescription(slug, type) {
  var title = slugToTitle(slug);
  if (type === 'protocol') return title + ' — automated scoring protocol';
  if (type === 'watchlist') return title + ' — symbol watchlist';
  if (type === 'broker') return title + ' — trading broker';
  return title;
}

/** Slug → friendly name hardcoded overrides for well-known entries */
var WATCHLIST_NAMES = {
  'forex-majors': { title: 'FOREX Majors', desc: 'EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD — the seven most liquid currency pairs' },
  'default': { title: 'Default Watchlist', desc: 'General-purpose symbol list' },
  'test-watchlist': { title: 'Test Watchlist', desc: 'Symbols for testing and validation' },
  'test-forex': { title: 'Test: Forex', desc: 'Forex pairs under evaluation' },
  'test-gold': { title: 'Test: Gold', desc: 'XAUUSD testing configuration' },
  'test-indices': { title: 'Test: Indices', desc: 'Index instruments under evaluation' },
};

var PROTOCOL_NAMES = {
  'built-in-default': { title: 'Default Pipeline', desc: 'Placeholder protocol — no custom directives active' },
  'mt5-technical-core-v1': { title: 'Technical Core v1', desc: '30 technical directives including RSI, MACD, ATR, Bollinger, VWAP, candlestick patterns, support/resistance, and volume analysis' },
};

var BROKER_NAMES = {
  'mt5': { title: 'MetaTrader 5', desc: 'Local bridge on port 5000 — direct market access for forex and commodities' },
  't212': { title: 'Trading 212', desc: 'ISA account — stocks and ETFs' },
};

/**
 * Look up a friendly name for a slug.
 * Priority: live API data → hardcoded override → slug-to-title conversion
 */
function lookupName(slug, type, liveMap) {
  // 1. Live API data (if provided)
  if (liveMap && liveMap[slug]) {
    return {
      title: liveMap[slug].title || liveMap[slug].name || slugToTitle(slug),
      desc: liveMap[slug].desc || liveMap[slug].description || defaultDescription(slug, type),
    };
  }
  // 2. Hardcoded override maps
  var hardcoded;
  if (type === 'protocol') hardcoded = PROTOCOL_NAMES[slug];
  else if (type === 'watchlist') hardcoded = WATCHLIST_NAMES[slug];
  else if (type === 'broker') hardcoded = BROKER_NAMES[slug];
  if (hardcoded) return hardcoded;
  // 3. Slug-to-title fallback
  return { title: slugToTitle(slug), desc: defaultDescription(slug, type) };
}

/** Interpret a composite score into a human signal */
function interpretScore(composite) {
  if (composite == null) return { signal: 'Waiting', strength: 'neutral', desc: 'No score data available yet' };
  if (composite >= 75) return { signal: 'Strong Buy', strength: 'strong-up', desc: 'High conviction — multiple directives agree on upward momentum' };
  if (composite >= 60) return { signal: 'Buy', strength: 'up', desc: 'Above-average conviction — most directives bullish' };
  if (composite >= 45) return { signal: 'Neutral', strength: 'neutral', desc: 'Mixed signals — no clear direction' };
  if (composite >= 30) return { signal: 'Sell', strength: 'down', desc: 'Below-average conviction — most directives bearish' };
  return { signal: 'Strong Sell', strength: 'strong-down', desc: 'High conviction — multiple directives agree on downward momentum' };
}

/** Interpret a rating band into a user-friendly label */
function interpretBand(band, rating) {
  var bands = {
    'Untested': { label: 'Not yet rated', icon: '○', desc: 'No trades executed through this MetaStack yet', color: '#6b7280' },
    'Bronze': { label: 'Bronze', icon: '●', desc: 'Early results — small sample size', color: '#cd7f32' },
    'Silver': { label: 'Silver', icon: '●●', desc: 'Consistent performance across multiple trades', color: '#c0c0c0' },
    'Gold': { label: 'Gold', icon: '●●●', desc: 'Proven profitability with strong risk-adjusted returns', color: '#ffd700' },
  };
  return bands[band] || bands['Untested'];
}

/** Produce a Focused (user-friendly) view of a MetaStack */
export function translateMetaStack(stack, protocols, scores, liveMaps) {
  var liveWL = (liveMaps && liveMaps.watchlists) || null;
  var liveProto = (liveMaps && liveMaps.protocols) || null;
  var liveBroker = (liveMaps && liveMaps.brokers) || null;

  var wl = lookupName(stack.watchlistName, 'watchlist', liveWL);
  var proto = lookupName(stack.protocolId, 'protocol', liveProto);
  var broker = lookupName(stack.brokerId, 'broker', liveBroker);
  var band = interpretBand(stack.band, stack.rating);

  // Scoring interpretations
  var scoreItems = [];
  if (Array.isArray(scores) && scores.length > 0) {
    scoreItems = scores.slice(0, 6).map(function (s) {
      return {
        symbol: s.symbol,
        technical: { composite: s.composite, signal: s.signal },
        focused: interpretScore(s.composite),
      };
    });
  }

  return {
    // Watchlist
    watchlistName: wl.title,
    watchlistDesc: wl.desc,
    watchlistSlug: stack.watchlistName,

    // Protocol
    protocolName: proto.title,
    protocolDesc: proto.desc,
    protocolSlug: stack.protocolId,
    directiveCount: stack.directiveCount || (protocols.length > 0 ? 'varies' : '—'),

    // Parameters
    baseSize: stack.baseSize || '0.01',
    slDescription: stack.slPct != null ? stack.slPct + '% fixed' : 'Adaptive (ATR-based)',
    tpDescription: stack.tpPct != null ? stack.tpPct + '% fixed' : 'Adaptive (ATR-based)',
    tradeThreshold: stack.tradeThreshold || 3,

    // Broker
    brokerName: broker.title,
    brokerDesc: broker.desc,
    brokerSlug: stack.brokerId,

    // Performance
    bandLabel: band.label,
    bandIcon: band.icon,
    bandDesc: band.desc,
    bandColor: band.color,
    rating: stack.rating || 0,
    totalTrades: stack.totalTrades || 0,
    winRate: stack.winRate > 0 ? (stack.winRate * 100).toFixed(0) + '%' : null,
    totalPnl: stack.totalPnl,
    hasTrades: stack.totalTrades > 0,

    // Scoring
    scores: scoreItems,
    hasScores: scoreItems.length > 0,
  };
}

export { WATCHLIST_NAMES, PROTOCOL_NAMES, BROKER_NAMES };
