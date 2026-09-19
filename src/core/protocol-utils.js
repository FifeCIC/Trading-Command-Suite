/**
 * Protocol Utilities — canonical protocol classification.
 * ========================================================
 * Extracted from ProtocolsPage.jsx and ProtocolsPageB.jsx (exact duplicates).
 *
 * @file src/core/protocol-utils.js
 */

/** Classify a protocol by its directive/data dependencies */
export function getProtocolType(proto) {
  const id = (proto.id || '').toLowerCase();
  const name = (proto.name || '').toLowerCase();
  const combined = id + ' ' + name;

  if (/news|sentiment|social/i.test(combined)) {
    return { label: 'News-Reactive', color: '#f59e0b', icon: '📰' };
  }
  if (/analyst|earnings|whisper/i.test(combined)) {
    return { label: 'Analyst-Driven', color: '#3b82f6', icon: '📊' };
  }
  if (/insider|congress/i.test(combined)) {
    return { label: 'Insider-Aware', color: '#a855f7', icon: '🔍' };
  }
  if (/macro|dxy|oil|gold|commodity/i.test(combined)) {
    return { label: 'Macro-Driven', color: '#14b8a6', icon: '🌍' };
  }
  return { label: 'Technical-Only', color: '#64748b', icon: '📈' };
}

/**
 * Timing class for a resolved symbol — which MARKET window governs an instrument,
 * and therefore WHEN a protocol can act. Used by the Protocols Registry display.
 *
 * ⚠️ THIS IS A DISPLAY GROUPING ONTO THE CALENDAR'S VENUES (`US`, `FX`), NOT the
 * gating map. The gate reads `nest/src/modules/calendar/market-patterns.ts`, which
 * carries the MEASURED broker windows (their header records why cash-exchange hours
 * for UK100/FRA40/GER40 were rejected). Keep the two consistent *in spirit*: an
 * "index CFD" is broker-quoted and follows the broker's week, so it belongs with FX
 * rather than with a cash exchange. When #850's follow-ups move this grouping
 * server-side, delete this copy rather than maintaining two maps.
 */
const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'DOGE']);
/** Index CFDs on the Pepperstone route — measured ~24h quoting, governed by the broker week. */
const INDEX_CFD_SYMBOLS = new Set(['UK100', 'GER40', 'FRA40', 'US500', 'US30', 'USTEC', 'VIX', 'CHINA50']);
/** US-listed instruments whose codes are too short to classify by shape alone. */
const US_LISTED_SYMBOLS = new Set(['SPY', 'QQQ', 'SOXS', 'SPXS', 'SQQQ', 'SRTY', 'TECS', 'YANG', 'FNGD']);

function symbolTimingClass(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (CRYPTO_SYMBOLS.has(s)) return 'crypto';
  // European-listed leveraged ETPs carry a leading `3` (3AMZ) or a trailing `3` (AMD3).
  if (/^3/.test(s) || /3$/.test(s)) return 'unmodelled';
  if (INDEX_CFD_SYMBOLS.has(s)) return 'week';
  if (US_LISTED_SYMBOLS.has(s)) return 'us';
  if (/^[A-Z]{6}$/.test(s) || s === 'WTI') return 'week'; // FX pairs, metals (XAUUSD/XAGUSD), energy
  if (/^[A-Z]{1,5}$/.test(s)) return 'us';                // plain US tickers
  return 'unmodelled';
}

/**
 * Group a protocol's resolved symbols by the market window that governs them.
 * Returns display groups in fixed order, each with the venue key the calendar
 * serves (`null` = no venue needed or none modelled).
 */
export function getProtocolTiming(resolvedSymbols) {
  const lists = { crypto: [], week: [], us: [], unmodelled: [] };
  for (const raw of resolvedSymbols || []) {
    const s = String(raw || '').toUpperCase();
    if (!s) continue;
    lists[symbolTimingClass(s)].push(s);
  }
  const groups = [];
  if (lists.crypto.length) {
    groups.push({ key: 'crypto', label: 'Crypto', venue: null, alwaysOpen: true, symbols: lists.crypto });
  }
  if (lists.week.length) {
    groups.push({ key: 'week', label: 'Broker week — FX, metals, energy, index CFDs', venue: 'FX', symbols: lists.week });
  }
  if (lists.us.length) {
    groups.push({ key: 'us', label: 'US equities — exchange hours', venue: 'US', symbols: lists.us });
  }
  if (lists.unmodelled.length) {
    groups.push({ key: 'unmodelled', label: 'European-listed ETPs', venue: null, symbols: lists.unmodelled });
  }
  return { groups };
}
