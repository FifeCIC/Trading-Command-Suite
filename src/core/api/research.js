import { apiGet, apiPost, apiPut } from './client';

/**
 * Fetch earnings calendar from Finnhub (via NestJS proxy).
 * @param {{ symbol?: string, months?: number }} params
 * @returns {Promise<{ source: string, horizonMonths: number, count: number, events: Array }>}
 */
export function fetchEarningsCalendar({ symbol, months } = {}) {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  if (months) params.set('months', String(months));
  const qs = params.toString();
  return apiGet(`/api/research/earnings/calendar${qs ? '?' + qs : ''}`);
}

/**
 * Earnings import settings (scope / market cap / session / auto-import).
 * @returns {Promise<{ autoImportEnabled, horizonMonths, scope, minMarketCap, timeOfDay, sources }>}
 */
export function fetchEarningsSettings() {
  return apiGet('/api/research/earnings/settings');
}

/**
 * Patch one or more earnings import settings.
 * @param {object} patch
 */
export function updateEarningsSettings(patch) {
  return apiPut('/api/research/earnings/settings', patch);
}

/**
 * Trigger a background earnings import (honors import settings).
 * @returns {Promise<{ started: boolean, message: string }>}
 */
export function importEarnings() {
  return apiPost('/api/research/earnings/import');
}

/**
 * Import status: running flag, stored event count, settings snapshot, last run.
 * @returns {Promise<{ running, storedEvents, settings, lastImport }>}
 */
export function fetchEarningsImportStatus() {
  return apiGet('/api/research/earnings/status');
}

/**
 * Fetch analyst price targets for one or more symbols.
 * @param {{ symbols: string[], sort?: string, order?: string }} params
 * @returns {Promise<{ source: string, count: number, targets: Array }>}
 */
export function fetchAnalystTargets({ symbols, sort, order } = {}) {
  const params = new URLSearchParams();
  if (symbols?.length) params.set('symbols', symbols.join(','));
  if (sort) params.set('sort', sort);
  if (order) params.set('order', order);
  return apiGet(`/api/research/analyst/targets?${params.toString()}`);
}

/**
 * Fetch analyst price target for a single symbol.
 * @param {string} symbol
 * @returns {Promise<{ source: string, target: object | null }>}
 */
export function fetchAnalystTarget(symbol) {
  return apiGet(`/api/research/analyst/targets/${encodeURIComponent(symbol)}`);
}
