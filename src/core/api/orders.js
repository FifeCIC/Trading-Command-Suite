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
