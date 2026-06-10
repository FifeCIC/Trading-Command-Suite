/**
 * Scoring API Client
 * ==================
 * TanStack Query wrapper functions for the scoring endpoints.
 * Use these in React components — do NOT call fetch/axios directly.
 */

import { apiGet } from './client';

/**
 * @param {string} [strategyId]
 * @param {number} [limit=20]
 */
export function fetchRankedSymbols(strategyId, limit = 20) {
  const params = new URLSearchParams();
  if (strategyId) params.set('strategy_id', strategyId);
  params.set('limit', String(limit));

  return apiGet(`/api/scoring/ranked?${params.toString()}`);
}
