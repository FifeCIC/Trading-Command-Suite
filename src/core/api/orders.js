/**
 * Orders API Client
 * =================
 * API wrapper for Trading212 order execution endpoints.
 */

import { apiGet, apiPost, apiDelete } from './client';

/**
 * Place a market sell order
 * @param {{ ticker: string, quantity: number, accountType?: 'investment'|'isa' }} params
 */
export function placeSellOrder(params) {
  return apiPost('/api/portfolio/trading212/orders/sell', params);
}

/**
 * Place a market buy order
 * @param {{ ticker: string, quantity: number, accountType?: 'investment'|'isa' }} params
 */
export function placeBuyOrder(params) {
  return apiPost('/api/portfolio/trading212/orders/buy', params);
}

/**
 * Get the trading-window assessment for one ticker (#1359).
 *
 * ⚠️ IT LIVES ON THE CALENDAR ROUTE, not the T212 one, because the answer belongs to the VENUE
 * axis — which exchange governs this instrument and whether its regular session is live. The
 * symbol→venue map is backend-only (`market-patterns.ts`); duplicating it here would be a second
 * copy that drifts.
 *
 * @param {string} ticker
 * @returns {Promise<{ticker:string, venueStatus:string, inRegularSession:boolean, judged:boolean,
 *   nextOpen:string|null, message:string, risks:Array<{id:string,label:string,detail:string}>}>}
 */
export function getOrderHours(ticker) {
  return apiGet(`/api/calendar/order-hours?ticker=${encodeURIComponent(ticker)}`);
}

/**
 * Get open orders
 */
export function getOpenOrders() {
  return apiGet('/api/portfolio/trading212/orders');
}

/**
 * Get a specific order's status
 * @param {string} orderId
 */
export function getOrderStatus(orderId) {
  return apiGet(`/api/portfolio/trading212/orders/${orderId}`);
}

/**
 * Cancel an open order
 * @param {string} orderId
 */
export function cancelOrder(orderId) {
  return apiDelete(`/api/portfolio/trading212/orders/${orderId}`);
}
