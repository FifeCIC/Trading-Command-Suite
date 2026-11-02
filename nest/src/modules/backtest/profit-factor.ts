/**
 * profit-factor.ts — the two profit factors, extracted so they can be tested against the code
 * that runs rather than against a copy of it.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO INLINE LINES (#126) ──
 *
 * Measured 2026-11-02 while A/B testing stop plans on XAGUSD: six arms moved net P&L from
 * +63.29 to −657.54 and EVERY arm reported `profitFactor 0.72`. The field was computed from
 * `returns10d` — the forward return of every ENTRY SIGNAL — so it cannot see an exit change.
 * The same day `btc-speed-v1` carried a stored factor of **956.87**, because
 * `grossLoss ... || 1` forced the denominator to 1 when nothing lost, turning the ratio into an
 * absolute value wearing a ratio's name.
 *
 * A spec that re-states the arithmetic cannot catch either defect — it would pass while the
 * service stayed wrong. That is the exact failure `development-philosophy` names: a declaration
 * is not validated by being well-formed. So the computation lives here, the service imports it,
 * and the spec imports the SAME function.
 *
 * ⚠️ TWO FACTORS, TWO QUESTIONS. Neither is a substitute for the other:
 *   `signalProfitFactor` — is the SIGNAL well behaved? Invariant to exits, by construction.
 *   `tradeProfitFactor`  — did the EXITS work? This is the one a stop comparison must use.
 */

/**
 * Profit factor of the ENTRY SIGNAL population: gross winning forward-return / gross losing.
 *
 * ⚠️ INVARIANT TO EXITS. Two runs with identical entries and different stop plans produce the
 * same value. That is not a bug in this function — it is what the population is — but reading it
 * as "the strategy's profit factor" is, and that reading is what produced the all-0.72 A/B.
 *
 * Returns NULL when there is no LOSING sample, never `grossProfit / 1`. NULL says "no losing
 * evidence to divide by", which is the true statement and matches how this project treats a
 * missing win rate (#1021) and a missing forward return (#1134).
 */
export function signalProfitFactor(returns: Array<number | null | undefined>): number | null {
  const usable = returns.filter((r): r is number => r != null && Number.isFinite(Number(r)));
  const grossProfit = usable.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(usable.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  if (grossLoss > 0) return grossProfit / grossLoss;
  return null;
}

/**
 * Profit factor of the TRADES that actually closed: gross winning currency / gross losing.
 *
 * This is the textbook definition and the only one that moves when the exits move. It is what a
 * stop-plan comparison, a trailing-stop A/B, or a "should I exit earlier?" question must read.
 *
 * Returns NULL when there are no trades, or when no trade lost — an all-winner sample has no
 * denominator, and inventing one is the defect this file exists to close.
 */
export function tradeProfitFactor(trades: Array<{ pnl: number | null | undefined }>): number | null {
  const pnls = trades
    .map((t) => t.pnl)
    .filter((p): p is number => p != null && Number.isFinite(Number(p)))
    .map(Number);
  if (pnls.length === 0) return null;
  const wins = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  return losses > 0 ? wins / losses : null;
}
