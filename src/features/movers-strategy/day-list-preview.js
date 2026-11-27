/**
 * day-list-preview.js — the five cells a day row shows in the picker, and what number goes in each.
 *
 * ── WHY THIS EXISTS (decided 2026-11-27) ──────────────────────────────────────────────────────────
 * A reader saw 1903.2% on the 11 Nov row for a name they remembered reading around 401%, sitting under a
 * column headed "Symbol 5", and reasonably asked whether the top-N pick ignored the day's biggest mover.
 * Both numbers were right and the column order meant nothing, which is worse than either being wrong.
 *
 * Two separate faults produced one confusing row:
 *
 * 1. **The number was the PEAK, presented as if it were the move.** NXXT's 11 Nov high of 3.74 came at
 *    19:00 — three and a half hours AFTER the 15:30 screen time — and against the previous close that
 *    is +1903%. The move the strategy could act on, at the screen time, was +430%. The picker showed the
 *    first with no label, so the page displayed a move 4.4× larger than anything tradeable.
 * 2. **The columns were ALPHABETICAL.** `symbols` was `.sort()`ed by ticker, so NXXT (the day's biggest
 *    mover by either measure) landed in column 5 because N comes late in the alphabet. The header said
 *    "Symbol 5", which reads as a rank.
 *
 * So each cell carries BOTH figures, and the row is ordered by the one that decides: the move at the
 * cutoff. `peak` is kept because it answers a real question — how far the name eventually ran — and
 * because hiding it would delete the reason the two numbers differ.
 *
 * ⚠️ THE PEAK IS NEVER SHOWN WITHOUT ITS LABEL. A bare second percentage beside a first is read as a
 * range or a duplicate; "peak" is what makes it a different measurement rather than a contradiction.
 */

/**
 * @param {Array<string>} symbols            already ordered by the SERVER on the cutoff move
 * @param {Record<string, number|null>} atCutoff
 * @param {Record<string, number|null>} peaks
 * @param {number} limit                     how many cells to render
 * @returns {Array<{symbol:string, atCutoff:number|null, peak:number|null, showPeak:boolean}>}
 */
export function previewCells(symbols, atCutoff, peaks, limit = 5) {
  const list = Array.isArray(symbols) ? symbols : [];
  return list.slice(0, limit).map((symbol) => {
    const c = atCutoff?.[symbol];
    const p = peaks?.[symbol];
    const at = typeof c === 'number' && Number.isFinite(c) ? c : null;
    const peak = typeof p === 'number' && Number.isFinite(p) ? p : null;
    return {
      symbol,
      atCutoff: at,
      peak,
      /**
       * ⚠️ ONLY WHEN IT DIFFERS MEANINGFULLY. Two figures that agree teach a reader to ignore the second;
       * a tolerance of 0.5pp keeps float noise out of the decision. When they differ, the gap IS the
       * information — that is how far the name ran after the screen time.
       */
      showPeak: peak !== null && (at === null || Math.abs(peak - at) > 0.5),
    };
  });
}

/** How many candidates a day holds beyond the cells shown — stated, because a silent cut reads as all. */
export function hiddenCount(symbols, limit = 5) {
  const n = Array.isArray(symbols) ? symbols.length : 0;
  return Math.max(0, n - limit);
}

/**
 * `atCutoff` as the display number, `—` when the ranking could not measure it.
 *
 * ⚠️ `null` PRINTS AS `—`, NEVER AS `0%`. A candidate with no bar at or before the cutoff has no move;
 * printing 0% would put an unmeasurable name level with a flat one, which is the collapse the ranker
 * refuses to make (`moveSoFarPct` returns null with a reason).
 */
export function formatMove(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—';
  /**
   * ⚠️ THE SIGN IS DECIDED AFTER ROUNDING, NOT BEFORE. `+0.04` rounded to one decimal is `0.0`, and a
   * `+0.0%` claims a rise where the reader sees nothing — the same "plausible output, no error" shape
   * as a blank cell reading as zero. A move that rounds to zero prints unsigned.
   */
  const rounded = Number(pct.toFixed(1));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}%`;
}
