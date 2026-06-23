import { apiGet } from './client';

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
