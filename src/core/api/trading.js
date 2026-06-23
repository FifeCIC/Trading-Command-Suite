import { apiGet, apiPost } from './client';

// ── MT5 Trading ──

export function fetchMt5Account() {
  return apiGet('/api/trading/mt5/account');
}

export function fetchMt5Positions() {
  return apiGet('/api/trading/mt5/positions');
}

export function fetchMt5History() {
  return apiGet('/api/trading/mt5/history');
}

export function placeMt5Order({ symbol, type, volume, sl, tp, comment }) {
  return apiPost('/api/trading/mt5/order', { symbol, type, volume, sl, tp, comment });
}

export function closeMt5Position(ticket) {
  return apiPost(`/api/trading/mt5/close/${ticket}`);
}

export function closeAllMt5Positions() {
  return apiPost('/api/trading/mt5/close-all');
}

export function closeProfitableMt5Positions() {
  return apiPost('/api/trading/mt5/close-profitable');
}

// ── Trading212 ──

export function sellAllProfitableT212() {
  return apiPost('/api/portfolio/trading212/close-profitable');
}

// ── Unified ──

export async function takeAllProfits() {
  const [mt5Result, t212Result] = await Promise.allSettled([
    closeProfitableMt5Positions().catch(() => null),
    sellAllProfitableT212().catch(() => null),
  ]);

  return {
    mt5: mt5Result.status === 'fulfilled' ? mt5Result.value : { closed: 0, failed: 0, skipped: 0, totalPnl: 0, closedTickets: [] },
    t212: t212Result.status === 'fulfilled' ? t212Result.value : { sold: 0, failed: 0, skipped: 0, totalPnl: 0, soldTickers: [] },
  };
}
