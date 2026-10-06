/**
 * shadow-supertrend.ts — #1077. A CANONICAL SuperTrend, computed for COMPARISON ONLY.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🛑 THIS VALUE IS NEVER READ BY A DECISION. NOTHING ACTS ON IT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHY IT EXISTS. `mt5-indicators.directives.ts` → `SuperTrendDirective` builds its bands from
 * the LAST BAR's own high/low:
 *
 *     const midline    = (lastHigh + lastLow) / 2;         // one bar's midpoint
 *     const basicUpper = midline + 3 * lastATR;            // ~unreachable: exceeds the bar's high
 *     const basicLower = midline - 3 * lastATR;
 *
 * so there is no ratchet and no trend memory. Measured on real 5m bars 2026-10-06: XAUUSD
 * `lastClose` 4169.30 vs `midline` 4168.38 — **0.92** decides `bullish` vs `bearish`, and the
 * `score 75` branches cannot fire. That directive is one of only two that ever contribute
 * directional evidence to the guardian's `>= 55` consensus, and it opposed **131 of 142**
 * evaluations while the other contributor was balanced 57/43 (#1077).
 *
 * Replacing it changes when a live stop moves, which is a MATHS change (exit path) and needs a
 * copied configuration and a monitored comparison — not an in-place edit. This file is that copy.
 * Its output is appended to the guardian's DECLINED line so that, after a real window, the
 * question *"would a working indicator have cleared `>= 55`?"* can be answered from data rather
 * than argued from the source.
 *
 * ⚠️ WHY THE ARITHMETIC IS IN THIS REPO AND NOT IMPORTED. The point is to have a SECOND,
 * INDEPENDENTLY-WRITTEN computation to compare against the incumbent. Importing the incumbent's
 * own helper would compare the defect with itself.
 *
 * ⚠️ WHAT IT IS NOT. It is not a proposal, not a tuned variant, and not evidence that a fix helps.
 * Until the shadow has run across a real window and been read, its output is UNMEASURED — do not
 * cite it as a result.
 */

/** Bars as the directives receive them: `{ high, low, close }` in oldest → newest order. */
export type ShadowBar = { high: number; low: number; close: number; timestamp?: unknown };

export type ShadowTrend = 'bullish' | 'bearish' | null;

/** True range for bar `i`, with the previous close when one exists. */
function trueRange(bars: ShadowBar[], i: number): number {
  const b = bars[i];
  const range = b.high - b.low;
  if (i === 0) return range;
  const prevClose = bars[i - 1].close;
  return Math.max(range, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
}

/**
 * Simple moving average of true range over `period`. Deliberately the same family of average the
 * incumbent's `atr()` helper uses, so the comparison isolates the BAND CONSTRUCTION rather than
 * changing two things at once.
 */
function atrSeries(bars: ShadowBar[], period: number): number[] {
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
 * shadowSuperTrend() — canonical ratcheting SuperTrend, `ATR(period) × multiplier`.
 *
 * BEFORE: the guardian has already fetched the position's own bars to score the four stop
 *         directives; this re-uses THAT SAME array, so both computations see one market view.
 * AFTER:  `'bullish'` / `'bearish'`, or `null` when the trend never established — and `null` is a
 *         THIRD state, never folded into either direction ("cannot judge" must not read as a call).
 * NEXT:   concatenated into the guardian's `consensusBreakdown` string and written with the
 *         DECLINED line. Nothing else reads it. See #1077 for the comparison and its terms.
 *
 * ⚠️ Returns `null` rather than guessing when there are too few bars for one ATR window plus a
 * ratchet step. An absent reading must be distinguishable from a real one.
 */
export function shadowSuperTrend(
  bars: ShadowBar[],
  period = 10,
  multiplier = 3,
): ShadowTrend {
  if (!Array.isArray(bars) || bars.length < period + 2) return null;

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
      // ⚠️ SEEDED ONCE, and this is the ONLY midpoint comparison in this file — which is the whole
      // difference from the incumbent. Without a seed the trend never establishes on a smooth
      // series (price stays inside its own bands), so the shadow would read `undetermined` on
      // exactly the trending markets it exists to judge. After this line the RATCHET governs.
      trend = close >= hl2 ? 'up' : 'down';
    } else if (trend === 'up') {
      if (close < finalLower) trend = 'down';
    } else {
      if (close > finalUpper) trend = 'up';
    }
  }

  if (trend === 'up') return 'bullish';
  if (trend === 'down') return 'bearish';
  return null;
}
