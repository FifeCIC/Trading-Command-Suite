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
