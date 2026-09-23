/**
 * drawdown.ts — THE drawdown definition for a P&L series. One implementation, two callers.
 * ==========================================================================================
 * Moved here (#954, 2026-09-23) from `risk/risk.controller.ts`, which #950 had fixed in place.
 * The consolidation closes a measured disagreement: `risk.controller` computed a percentage of the
 * series' peak while `trading/bot-performance.service.ts` refused a percentage altogether — two
 * implementations of one idea, landing hours apart, with opposite conclusions. Both now call this.
 *
 * WHAT IT IS. Peak-to-trough of the CUMULATIVE realised P&L over the window: `currency` is the
 * worst fall below the running high-water mark, and `pctOfPeak` is that fall as a % of the peak.
 *
 * ⚠️ WHAT IT IS NOT. Not portfolio drawdown — there is no equity series here, only the running sum
 * of closed trades' P&L. Peak P&L is NOT a capital base, so the percentage is only stated when the
 * arithmetic is possible (#954): `pctOfPeak` is null when `peak <= 0` **or when `currency > peak`**
 * — a ratio above 100% means the denominator is not a base at all. Measured 2026-09-22, four
 * ordinary shapes produced 1566.7%, 1680%, 1800% and 2050%; those now report null with the currency
 * figure, and `drawdown.spec.ts` canaries the impossible-ratio rule in both directions.
 *
 * ⚠️ BASELINE (#954): the peak starts at **0**, not at the first trade's P&L — a series that opens
 * with a loss has a genuine decline from zero, and a "peak" below zero is a contradiction
 * (bot-performance's original reasoning, now unified here). #950 had started the peak at the first
 * cumulative value; the all-loss window therefore read "£50 below its peak" where the honest figure
 * is £55 below zero, and a single losing trade read as no drawdown at all.
 *
 * ⚠️ ORDER: input is NEWEST-FIRST (that is how the risk controller queries trades) and is walked
 * chronologically. Peak-to-trough is a property of the SEQUENCE — an unordered series measures
 * nothing, and that is the single easiest way to get a plausible wrong number here.
 *
 * KNOWN LIMITATION, stated not implied: pctOfPeak remains a percentage of peak P&L for the cases
 * where it is bounded. ⚠️ As of 2026-09-23 a per-bot capital base DOES exist — #894 added
 * `trading_strategy.allocationAmount` — so percentage-of-peak is no longer the only available
 * form: the RATING expresses drawdown against the allocation (bot-performance.service.ts), and
 * only the risk breaker's ratio branch still uses pctOfPeak. Prefer the allocation as a
 * denominator in any new consumer; do not read this function's ratio as a capital percentage.
 */

export interface DrawdownDetail {
  /** The worst fall below the running high-water mark, in P&L currency units. Always the true figure. */
  currency: number;
  /**
   * The fall as a % of the peak — stated ONLY when the arithmetic is possible (#954):
   * null when the peak is not positive, and null when `currency > peak` (an impossible ratio).
   */
  pctOfPeak: number | null;
  /** Cumulative P&L at the high-water point of the window (floored at 0, see the header). */
  peak: number;
  /** Cumulative P&L at the lowest point after that peak. */
  trough: number;
  trades: number;
  peakAt: string | null;
  troughAt: string | null;
}

export function computeDrawdownDetail(
  trades: Array<{ pnl: number | null; closedAt: Date | null | string }>,
): DrawdownDetail {
  const empty: DrawdownDetail = {
    currency: 0, pctOfPeak: null, peak: 0, trough: 0, trades: 0, peakAt: null, troughAt: null,
  };
  if (!trades.length) return empty;

  const chrono = [...trades].reverse();
  let cum = 0;
  // The baseline is 0: a window that never rises above zero still has a high-water mark — zero.
  let peak = 0;
  let peakAt: string | null = null;
  let trough = Number.POSITIVE_INFINITY;
  let troughAt: string | null = null;
  let best: DrawdownDetail = empty;

  for (const t of chrono) {
    cum += t.pnl || 0;
    const at = t.closedAt ? new Date(t.closedAt).toISOString() : null;
    if (cum > peak) {
      peak = cum;
      peakAt = at;
      trough = cum;
      troughAt = at;
    } else if (cum < trough) {
      trough = cum;
      troughAt = at;
    }
    const fall = peak - trough;
    if (fall > best.currency) {
      best = {
        currency: fall,
        pctOfPeak: null,
        peak,
        trough,
        trades: chrono.length,
        peakAt,
        troughAt,
      };
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  // ⚠️ A window that PEAKED and never fell has no drawdown to report, but it still has a peak.
  // Without this, `best` stays the placeholder and `peak: 0` claims "no high-water at all" —
  // "peaked at +8 and never fell" must not read as "never rose above zero".
  if (best.currency === 0) {
    best = {
      currency: 0,
      pctOfPeak: null,
      peak: peak === Number.NEGATIVE_INFINITY ? 0 : peak,
      trough: trough === Number.POSITIVE_INFINITY ? 0 : trough,
      trades: chrono.length,
      peakAt,
      troughAt,
    };
  }
  best.currency = round2(best.currency);
  best.peak = round2(best.peak === Number.NEGATIVE_INFINITY ? 0 : best.peak);
  best.trough = round2(best.trough === Number.POSITIVE_INFINITY ? 0 : best.trough);
  best.trades = chrono.length;
  // ── The ratio rule (#954) ─────────────────────────────────────────────────────────────────
  // Stated ONLY when the arithmetic is possible: a positive peak AND a fall no larger than that
  // peak. `currency > peak` is the impossible-ratio signature — a percentage above 100 of a P&L
  // peak means the denominator is not a capital base. Do not "simplify" the second condition
  // away; drawdown.spec.ts canaries it, and removing it reintroduces 1,600%+ risk-surface figures.
  best.pctOfPeak =
    best.peak > 0 && best.currency <= best.peak
      ? Math.round((best.currency / best.peak) * 1000) / 10
      : null;
  return best;
}
