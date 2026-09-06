/**
 * Signals API — /api/signals/* (#684 Signals v1).
 * ==============================================
 * The best-of opportunities ladder: action-only envelopes from every
 * active protocol, ranked by combined strength (signal + opportunity).
 */
import { apiGet, apiPost } from './client';

/** GET /api/signals/best — ranked actionable opportunities. */
export function fetchBestSignals() {
  return apiGet('/api/signals/best');
}

/** GET /api/signals/dismissals — active dismissals (show-dismissed toggle). */
export function fetchSignalDismissals() {
  return apiGet('/api/signals/dismissals');
}

/** POST /api/signals/dismiss — hide a signal for N hours (default 1). */
export function dismissSignal({ symbol, protocolId, hours = 1, strengths }) {
  return apiPost('/api/signals/dismiss', {
    symbol,
    protocolId,
    hours,
    ...(strengths || {}),
  });
}

/** GET /api/signals/analytics — feedback-loop observability (#693). */
export function fetchSignalAnalytics() {
  return apiGet('/api/signals/analytics');
}

/** GET /api/signals/trade-defaults — persisted manual-trade defaults (#720). */
export function fetchTradeDefaults() {
  return apiGet('/api/signals/trade-defaults');
}

/** GET /api/signals/:id/action — bot-action state (none | pending | filled). */
export function fetchSignalAction(signalId) {
  return apiGet(`/api/signals/${signalId}/action`);
}

/**
 * POST /api/signals/:id/trade — manual trade through the bot's safety chain.
 * body: { side: 'BUY'|'SELL', brokerId?: 'mt5'|'trading212', size?, slPct?, tpPct? }
 */
export function tradeSignal(signalId, body) {
  return apiPost(`/api/signals/${signalId}/trade`, body);
}

/**
 * POST /api/signals/:id/plan — Signals → Trading handover (#702).
 * Queues the signal as a draft trading plan carrying the signal context.
 * body: { direction: 'LONG'|'SHORT', protocolName?, context? }
 */
export function createSignalPlan(signalId, body) {
  return apiPost(`/api/signals/${signalId}/plan`, body);
}
