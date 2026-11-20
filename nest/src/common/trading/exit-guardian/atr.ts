/**
 * atr.ts — the guardian's ATR, once.
 *
 * ── WHAT IT IS, AND WHAT IT IS NOT ─────────────────────────────────────────────────────────────
 * A plain mean of the TRUE RANGE over the first 14 bars the guardian was handed — not Wilder's
 * smoothed ATR, and not the `atrPeriod` the backtest's `atrEqualRisk` sizing model uses. Both are
 * legitimate; they are different numbers. Extracted rather than "improved", because changing the
 * formula here would silently move every stop the guardian places.
 *
 * ⚠️ IT READS FROM INDEX 1, so it needs at least two bars and it uses at most 14 ranges. A caller
 * passing 30 bars gets the FIRST 14, not the last — that is the existing behaviour and is asserted,
 * because "recent bars" is what a reader would assume instead.
 *
 * Part of the #1242 extraction. Pure: no Nest, no Prisma, no clock.
 */

export interface AtrBar {
  high: number;
  low: number;
  close: number;
}

/** The number of true ranges averaged. Named so a caller cannot quietly change it. */
export const ATR_RANGE_COUNT = 14;

/**
 * Mean true range over the first `ATR_RANGE_COUNT` bars.
 *
 * Returns `0` when no range could be computed — the caller's existing behaviour, and the reason
 * `protectiveSl`/sizing must treat 0 as "cannot judge" rather than "a tight stop".
 */
export function computeAtr(bars: readonly AtrBar[]): number {
  if (!Array.isArray(bars) || bars.length < 2) return 0;

  const limit = Math.min(ATR_RANGE_COUNT + 1, bars.length);
  const ranges: number[] = [];
  for (let i = 1; i < limit; i++) {
    const prevClose = Number(bars[i - 1].close);
    const high = Number(bars[i].high);
    const low = Number(bars[i].low);
    const close = Number(bars[i].close);
    if (![prevClose, high, low, close].every((n) => Number.isFinite(n))) return 0;
    ranges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }

  if (!ranges.length) return 0;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}
