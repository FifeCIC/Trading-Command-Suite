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

export interface PnlRow {
  symbol: string;
  pnl: number | null;
  avgPrice: number;
  quantity: number;
}

export interface PnlBreach {
  symbol: string;
  pnl: number;
  pnlPct: number;
}

/**
 * pnlBreaches() — every position whose absolute P&L move exceeds the threshold, worst first.
 *
 * ⚠️ `Math.abs` is PRESERVED deliberately. The original alerted on large PROFITS as well as losses
 * (severity `info` vs `warning`), and that is a reasonable call — a position running far into profit
 * is worth knowing about. Changing it here would be a behaviour change smuggled in with a bug fix.
 *
 * ⚠️ Excluded, and each for a measured reason:
 *   - `pnl === null` — not yet priced. Reporting it as a breach would invent a number.
 *   - `avgPrice <= 0` — the original guard, kept: the percentage is a division by the notional, and
 *     a zero notional produces Infinity, which then compares greater than any threshold. That is a
 *     fabricated alert, not a rounding error.
 *   - `quantity === 0` — same division, same fabricated Infinity.
 */
export function pnlBreaches(rows: readonly PnlRow[], thresholdPct: number): PnlBreach[] {
  const out: PnlBreach[] = [];
  for (const p of rows) {
    if (p.pnl == null || !Number.isFinite(p.pnl)) continue;
    const notional = p.avgPrice * p.quantity;
    if (!Number.isFinite(notional) || notional === 0) continue;

    const pnlPct = Math.abs(p.pnl / notional) * 100;
    if (!Number.isFinite(pnlPct)) continue;
    if (pnlPct > thresholdPct) out.push({ symbol: p.symbol, pnl: p.pnl, pnlPct });
  }
  // WORST FIRST, so the message leads with what matters — and so a cap at the end of a long list
  // drops the least significant entries rather than an arbitrary tail.
  return out.sort((a, b) => b.pnlPct - a.pnlPct);
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
 */
export function pnlAlertMessage(breaches: readonly PnlBreach[], cap = 6): string {
  const shown = breaches.slice(0, cap).map((b) => {
    const dir = b.pnl > 0 ? '+' : '';
    return `${b.symbol} ${dir}${b.pnl.toFixed(2)} (${b.pnlPct.toFixed(1)}%)`;
  });
  const hidden = breaches.length - shown.length;
  const tail = hidden > 0 ? ` (+${hidden} more)` : '';
  return `${breaches.length} position(s) past threshold: ${shown.join(', ')}${tail}.`;
}
