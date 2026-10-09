/**
 * supertrend.ts — THE canonical ratcheting SuperTrend (`ATR(period) × multiplier`).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * HISTORY — this arithmetic existed first as `shadow-supertrend.ts` (#1077 option A, 2026-10-07)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `SuperTrendDirective` used to build its bands from the LAST BAR's own high/low
 * (`midline ± 3×ATR`), so there was no ratchet and no trend memory: the `score 75` branches
 * were unreachable by construction (the band exceeds the bar whenever `ATR > range/6`) and the
 * ±55 call was decided by a fraction of a pip (XAUUSD: 0.92 in #1077).
 *
 * The shadow ran for two measured days (876 declines): a corrected indicator would open the
 * guardian's ≥55 gate on 475 of them — but only **9** would move a stop (7 tickets), and later
 * price reached **none** of those levels. The OWNER CHOSE "B" (2026-10-09, review-queue R50):
 * replace the incumbent with this computation. This file is now the ONE implementation — the
 * shadow module is deleted, and nothing computes SuperTrend anywhere else.
 *
 * ⚠️ THE SEED IS THE ONLY MIDPOINT COMPARISON. Without it the trend never establishes on a
 * smooth series (price stays inside its own bands) — after the seed the RATCHET governs.
 * Use `supertrend` (utils/indicators.ts) for nothing — it has no callers and does not ratchet.
 */

/** Bars as the directives receive them: `{ high, low, close }` in oldest → newest order. */
export type SuperTrendBar = { high: number; low: number; close: number; timestamp?: unknown };

export interface SuperTrendReading {
  /** `'up'` / `'down'`, or `null` when the trend never established — a THIRD state, never guessed. */
  direction: 'up' | 'down' | null;
  /** The ratified trailing line at the last bar (`finalLower` when up, `finalUpper` when down). */
  trendLine: number | null;
  /** The last ATR(period) reading (SMA of true range), or `null` with too few bars. */
  atr: number | null;
}

/** True range for bar `i`, with the previous close when one exists. */
function trueRange(bars: SuperTrendBar[], i: number): number {
  const b = bars[i];
  const range = b.high - b.low;
  if (i === 0) return range;
  const prevClose = bars[i - 1].close;
  return Math.max(range, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
}

/** Simple moving average of true range over `period` — the same family the old `atr()` helper uses. */
function atrSeries(bars: SuperTrendBar[], period: number): number[] {
  const trs = bars.map((_, i) => trueRange(bars, i));
  const out: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += trs[j];
    out.push(sum / period);
  }
  return out;
}

/**
 * computeSuperTrend() — canonical ratcheting SuperTrend.
 *
 * BEFORE: the caller has the bars already fetched for its own scoring; this never fetches.
 * AFTER:  a `SuperTrendReading` — see the interface for the three-state direction.
 * NEXT:   `SuperTrendDirective.calculate()` maps the direction to its signalClass; the stop
 *         guardian consumes that class via its normal consensus. See #1077.
 *
 * ⚠️ `null` (never established) is reported rather than guessed. An absent reading must be
 * distinguishable from a real one — "cannot judge" is not a direction.
 */
export function computeSuperTrend(
  bars: SuperTrendBar[],
  period = 10,
  multiplier = 3,
): SuperTrendReading {
  if (!Array.isArray(bars) || bars.length < period + 2) {
    return { direction: null, trendLine: null, atr: null };
  }

  const atr = atrSeries(bars, period);
  let finalUpper = NaN;
  let finalLower = NaN;
  let trend: 'up' | 'down' | null = null;

  for (let i = period; i < bars.length; i++) {
    const a = atr[i];
    if (!Number.isFinite(a)) continue;

    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUpper = hl2 + multiplier * a;
    const basicLower = hl2 - multiplier * a;
    const close = bars[i].close;
    const prevClose = bars[i - 1].close;

    // ── Ratchet: a band only moves in its own direction, or resets when price closes through ──
    if (!Number.isFinite(finalUpper)) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
    }

    // ── Trend flip uses the PREVIOUS bar's final bands, as the published definition does ──
    if (trend === null) {
      // ⚠️ SEEDED ONCE — the ONLY midpoint comparison in this file. After this the RATCHET governs.
      trend = close >= hl2 ? 'up' : 'down';
    } else if (trend === 'up') {
      if (close < finalLower) trend = 'down';
    } else {
      if (close > finalUpper) trend = 'up';
    }
  }

  const lastAtr = atr[atr.length - 1];
  const trendLine = trend === 'up' ? finalLower : trend === 'down' ? finalUpper : null;
  return {
    direction: trend,
    trendLine: Number.isFinite(trendLine as number) ? (trendLine as number) : null,
    atr: Number.isFinite(lastAtr) ? lastAtr : null,
  };
}
