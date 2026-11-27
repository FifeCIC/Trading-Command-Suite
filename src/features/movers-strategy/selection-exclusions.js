/**
 * selection-exclusions.js — WHY THE RUN COUNTED FEWER TRADES THAN THE ENGINE PRODUCED.
 *
 * ── THE QUESTION THIS ANSWERS, AND IT IS THE OWNER'S OWN ─────────────────────────────────────────
 * *"Our data has a 430.3% change but our strategy achieves 36.4% win rate."* Part of the answer is
 * sitting in the payload and was rendered as a single unexplained number: the day table had an
 * **Excluded: 34** column with nothing saying what 34 was. Measured 2026-11-27 on
 * `movers-winners-2026-11-11`, the 34 was **25 + 9**, and the two halves mean opposite things.
 *
 * ── THE TWO CODES, AND WHY THEY MAY NEVER BE ADDED SILENTLY ───────────────────────────────────
 * `applySelection()` (`nest/src/modules/backtest/selection-ranking.ts`) drops a trade for exactly one
 * of two reasons, and they are different findings about different things:
 *
 *   · **before-cutoff** — the symbol WAS the pick, but the entry came before `cutoffUtc`. This is the
 *     EXPERIMENT'S OWN RULE: the ranking is computed from bars at or before the cutoff, so a trade at
 *     09:31 would be scored against information the strategy did not have. LOWERING THE CUTOFF MAKES
 *     THIS NUMBER BIGGER. It is a measurement decision, not a strategy behaviour.
 *
 *   · **not-selected** — the engine would have traded a name the ranker did not pick, on a date it was
 *     not picked for. This is THE STRATEGY'S SELECTIVITY. It is the number that answers "the sector
 *     moved 430% and we made 2%" — we were not in it, by choice.
 *
 * ⚠️ THE WARM-UP DAYS ARE MOST OF `not-selected`, AND THAT IS NOT A BUG. A movers dataset carries five
 * prior sessions as directive warm-up, and the engine runs across all of them. Only the dataset's own
 * answer day can ever be selected (`selectAnswerDay()`), so every trade on the other four sessions is
 * dropped as `not-selected`. Saying "25 trades excluded" without that sentence invites the reader to
 * conclude the strategy declined 25 opportunities on the day it was measured.
 *
 * ── WHY THIS IS DERIVED HERE RATHER THAN READ FROM `totals` ────────────────────────────────────
 * `totals.engineTradesOutsideSelection` already carries the sum, and this module recomputes it from
 * `perSymbol` so the total and the split come from ONE place. Reading the total from `totals` and the
 * split from `perSymbol` would let a header and its breakdown disagree — the silent shape this repo
 * keeps paying for. `total` is asserted against the server's figure by the page's test, so the two
 * cannot drift without a failure.
 *
 * ── DECISION (2026-11-19, primary) ──
 * WHAT:      The day table shows the exclusion SPLIT under the total, derived from `perSymbol`, and the
 *            column is named "Not counted" with a `WhyPopover` stating both meanings.
 * WHY:       Measured on `movers-winners-2026-11-11`: the cell read `34`, which was `25 not picked + 9
 *            pre-cutoff`. Those are the strategy's selectivity and the test's own cutoff rule — opposite
 *            findings — and a reader saw only their sum.
 * INSTEAD OF: Keeping `totals.engineTradesOutsideSelection` and adding a second number beside it. Two
 *            sources for one sum lets the header and its breakdown describe different runs.
 * REVERSE BY: Render `d.excluded` alone again in `ResultByDayStep.jsx`, set `excluded` back to
 *            `r.totals?.engineTradesOutsideSelection`, and delete this module and its test.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 309
 * GUARD:     npm run test:components  (+ the 'drops the exclusion SPLIT' case in canary-component-tests)
 */

/** The two drop codes, in the order `applySelection()` tests them, with what each one means. */
export const EXCLUSION_CODES = [
  {
    code: 'not-selected',
    label: 'not picked',
    /**
     * One sentence a reader can act on. ⚠️ It names the warm-up sessions, because a reader who does not
     * know they exist will read this number as the strategy declining opportunities on the measured day.
     */
    tells:
      'the engine would have traded a name the ranker did not pick — including every trade on the '
      + 'dataset\'s warm-up sessions, which can never be selected',
  },
  {
    code: 'before-cutoff',
    label: 'pre-cutoff',
    tells:
      'the pick was right but the entry came before the screen time, so the ranking did not exist yet. '
      + 'This is the test\'s rule: lowering the cutoff makes this number bigger',
  },
];

/**
 * summariseExclusions(perSymbol) — the split, or `null` when there is nothing to split.
 *
 * ⚠️ `null`, NOT ZEROS, when no symbol reported. A failed day has no `perSymbol` at all, and a table
 * showing `0` for it would read as "the engine produced nothing to exclude" — which is the
 * plausible-number-no-error shape this repo designs against. The caller renders an em dash.
 */
export function summariseExclusions(perSymbol) {
  if (!Array.isArray(perSymbol) || perSymbol.length === 0) return null;

  let kept = 0;
  let notSelected = 0;
  let beforeCutoff = 0;
  let reported = 0;

  for (const row of perSymbol) {
    // A symbol that failed to run carries no counts. Counting it as zero would understate the split.
    if (!row || typeof row !== 'object') continue;
    const n = Number(row.trades);
    const ns = Number(row.excludedNotSelected);
    const bc = Number(row.excludedBeforeCutoff);
    if (!Number.isFinite(ns) && !Number.isFinite(bc)) continue;
    reported += 1;
    kept += Number.isFinite(n) ? n : 0;
    notSelected += Number.isFinite(ns) ? ns : 0;
    beforeCutoff += Number.isFinite(bc) ? bc : 0;
  }

  if (reported === 0) return null;

  const byCode = EXCLUSION_CODES.map((c) => ({
    ...c,
    count: c.code === 'not-selected' ? notSelected : beforeCutoff,
  }));

  return {
    kept,
    notSelected,
    beforeCutoff,
    total: notSelected + beforeCutoff,
    byCode: byCode.filter((c) => c.count > 0),
    /** The engine's trades across the whole window, of which `kept` were counted. */
    engineTotal: kept + notSelected + beforeCutoff,
  };
}
