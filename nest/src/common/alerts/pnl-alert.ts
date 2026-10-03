/**
 * pnl-alert.ts — which positions breach the P&L threshold, and what to say about them.
 *
 * ── THE DEFECT THIS REPLACES ──
 *
 * `AlertTriggerService.checkPositionPnl()` looped the open positions and **returned on the first
 * match**:
 *
 *     for (const pos of positions) {
 *       if (pnlPct > thresholdPct) return { triggered: true, title: `${pos.symbol} P&L Alert`, … };
 *     }
 *
 * ⚠️ **Measured 2026-10-02:** one permanently-loss-making position (R3NK, −34.8%) always sorts into
 * that first slot, so the alert fired **872 times in two hours — every one of them naming R3NK**.
 * The other eight open positions could not be reported at all. The channel was not noisy; it was
 * **consumed**, and a second position blowing through the threshold would have been invisible.
 *
 * ⚠️ AND THE TITLE WAS THE OTHER HALF. `"${symbol} P&L Alert"` makes the collapse key PER SYMBOL, so
 * each breach creates its own permanent row rather than one row that reports the state. The title is
 * now stable and the MESSAGE names every breach.
 *
 * ── WHY THIS IS THE RIGHT SHAPE FOR A FRESH INSTALL ──
 *
 * Nothing here compensates for our data. A new installation with one position, or with ten, gets the
 * same rule: **report every breach, worst first, in one alert.** The old behaviour was not "tuned
 * for our situation" — it was simply wrong, and it happened to be most visible on our book because
 * we hold one outsized loser.
 */

import { profitPctFor } from '../trading/peak';

export interface PnlRow {
  symbol: string;
  side?: string | null;
  avgPrice: number;
  currentPrice: number | null;
  pnl: number | null;
}

export interface PnlBreach {
  symbol: string;
  pnl: number | null;
  /** The PRICE MOVE as a signed percentage — the number the threshold is applied to. */
  movePct: number;
}

/**
 * pnlBreaches() — every position whose PRICE MOVE exceeds the threshold, worst first.
 *
 * ⚠️ THE THRESHOLD IS APPLIED TO THE PRICE MOVE, NOT TO `pnl / notional`. That is not a
 * preference — the old formula was structurally wrong, and measured 2026-10-03 it was wrong by
 * **~88,000×** on FX:
 *
 *     pct = Math.abs(pnl / (avgPrice * quantity)) * 100
 *     USDCHF  quantity 0.01 @ 0.82806 -> 0.82878   computed 7970.4%   actual move 0.09%
 *
 * TWO errors, one line, and both are the same mistake — dividing money in one currency or unit by a
 * notional in another:
 *
 *   1. **FX `quantity` is LOTS, not units.** 0.01 lots of USDCHF is ~$1,000 of notional, not the
 *      $0.0083 the multiplication produces.
 *   2. **`pnl` is in ACCOUNT currency, the notional in the INSTRUMENT's.** For a USD stock on a GBP
 *      account the result is silently multiplied by GBPUSD — measured MSTR at 37.1% against a real
 *      −49.9% move, a ratio of ~0.74.
 *
 * ⚠️ It went unnoticed because the old check RETURNED ON THE FIRST MATCH: one FX position was
 * always reported, its absurd percentage was never compared against anything, and no other symbol
 * was ever shown. That is why the near-identical defect reports arrived together.
 *
 * The price move is unit-free AND currency-free, and `profitPctFor()` already owns the long/short
 * sign rule from #998 — a second implementation of that here would be the duplication this repo
 * warns about.
 *
 * ⚠️ Rows are still SKIPPED, not reported, when:
 *   - `currentPrice` is null — not priced. A move cannot be computed, and reporting the position as
 *     a breach would invent a number.
 *   - `avgPrice` is 0 or non-finite — the divisor. A zero entry produces Infinity, which exceeds
 *     every threshold and fabricates an alert.
 */
export function pnlBreaches(rows: readonly PnlRow[], thresholdPct: number): PnlBreach[] {
  const out: PnlBreach[] = [];
  for (const p of rows) {
    if (p.currentPrice == null || !Number.isFinite(p.currentPrice)) continue;
    if (!Number.isFinite(p.avgPrice) || p.avgPrice === 0) continue;

    const move = profitPctFor(p.side, p.avgPrice, p.currentPrice);
    if (move == null || !Number.isFinite(move)) continue;

    if (Math.abs(move) > thresholdPct) {
      out.push({ symbol: p.symbol, pnl: p.pnl, movePct: move });
    }
  }
  // WORST FIRST, so the message leads with what matters — and so a cap at the end of a long list
  // drops the least significant entries rather than an arbitrary tail.
  return out.sort((a, b) => Math.abs(b.movePct) - Math.abs(a.movePct));
}

/** The worst breach, or null. Drives severity so the alert's weight matches what it is reporting. */
export function worstBreach(breaches: readonly PnlBreach[]): PnlBreach | null {
  return breaches.length ? breaches[0] : null;
}

/**
 * pnlAlertMessage() — names EVERY breach, not just the first.
 *
 * ⚠️ It also says how many were hidden when the list is long. A message that silently truncates
 * reads as "this is the whole story", which is how the single-symbol version misled.
 *
 * ⚠️ The move% is shown, NOT a percentage derived from `pnl` — the currency amount is included
 * because it is useful, but the threshold number is the one a reader can sanity-check against the
 * market.
 */
export function pnlAlertMessage(breaches: readonly PnlBreach[], cap = 6): string {
  const shown = breaches.slice(0, cap).map((b) => {
    const money = b.pnl == null ? 'n/a' : `${b.pnl > 0 ? '+' : ''}${b.pnl.toFixed(2)}`;
    // ⚠️ The move carries its own sign too. Without it a +50% winner and a loss read alike at a
    // glance, which is the one thing an alert must not do.
    const move = `${b.movePct > 0 ? '+' : ''}${b.movePct.toFixed(2)}%`;
    return `${b.symbol} ${money} (${move})`;
  });
  const hidden = breaches.length - shown.length;
  const tail = hidden > 0 ? ` (+${hidden} more)` : '';
  return `${breaches.length} position(s) past threshold: ${shown.join(', ')}${tail}.`;
}
