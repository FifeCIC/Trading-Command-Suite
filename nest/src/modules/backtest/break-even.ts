/**
 * break-even.ts — HOW OFTEN A RUN'S TRADES MUST WIN to pay for themselves.
 *
 * ── DECISION (2026-10-31, primary) ──
 * WHAT:      The break-even win rate is MEASURED from the run's own trades — avg win, avg loss, one
 *            division — and takes no cost, bracket, threshold or settings input at all.
 * WHY:       The first version modelled it from bracket levels plus a cost, and the cost was already
 *            inside those levels. It overstated the requirement by 9–13 percentage points (88.0%
 *            where the truth is 74.9%). Measuring cannot make that class of mistake: `pnlPct` is
 *            net of spread, slippage and commission, so the answer is arithmetic on the data.
 * INSTEAD OF: Keeping the bracket formula and subtracting the double-counted cost term, which would
 *            have left the same fragile inference in place and still relied on a cost figure that
 *            may be unknown on older rows.
 * REVERSE BY: Reintroducing a `costPct` parameter — `break-even.spec.ts` asserts the function has
 *            none, and pins 74.9% against the old 88.0%, so a revert fails both.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 105
 * GUARD:     nest/src/modules/backtest/break-even.spec.ts (17 tests, canaried both directions) —
 *            every number on the Result page can also be checked by hand from the two averages
 *            printed beside it, which is the point.
 *
 * ⚠️ THE HISTORY IS KEPT BECAUSE THE REASON MATTERS MORE THAN THE FIX.
 *
 * ── WHAT THE FIRST VERSION DID, AND WHY IT WAS WRONG ───────────────────────────────────────────
 * It solved expectancy from the BRACKET plus the COST:
 *
 *     p = (stopPct + costPct) / (targetPct + stopPct)
 *
 * where `stopPct`/`targetPct` were measured from the `stopLoss`/`takeProfit` recorded on each trade
 * against `entryPrice`. But `entryPrice` is ALREADY `close × (1 + spread/2 + slippage)` — the entry
 * leg of the cost is baked into the price the trade was opened at. So the distance from entry to the
 * stop already contained the cost, the distance to the target was already reduced by it, and the
 * formula then added `costPct` a second time. Measured against the alternative below:
 *
 *     run        bracket+cost   empirical   overstatement
 *     1bbf1860       88.0%        74.9%        +13.1pp
 *     568c5552       57.7%        48.8%         +8.9pp
 *
 * ⚠️ THE OWNER ASKED WHETHER THIS WAS *"just playing about with hardcoded maths"*. It was not
 * hardcoded — but it WAS an inference about costs layered on prices that already contained them,
 * and the only way to see that was to compute the same answer a second way and compare. Both numbers
 * are kept above so the next reader can check the arithmetic rather than trust the prose.
 *
 * ── WHAT IT DOES NOW: MEASURE, DO NOT MODEL ─────────────────────────────────────────────────────
 * A trade's `pnlPct` is net of spread, slippage AND commission, as a percentage of entry cost. So
 * the run already CONTAINS the cost of trading inside two numbers:
 *
 *     avgWinPct  — the mean `pnlPct` of trades that made money
 *     avgLossPct — the mean |`pnlPct`| of trades that lost
 *
 * Break-even is then one division, with no cost model, no bracket, no thresholds, nothing to tune:
 *
 *     p · avgWin = (1 − p) · avgLoss      →      p = avgLoss / (avgWin + avgLoss)
 *
 * ✅ EVERY NUMBER ON SCREEN CAN BE CHECKED BY HAND. The page prints avg win, avg loss and the
 * required rate; a reader divides the first by their sum and gets the third. Nothing is hidden in a
 * constant, and there is no setting whose absence changes the answer.
 *
 * ⚠️ IT CANNOT BE COMPUTED FOR A ONE-SIDED RUN, AND THAT IS REPORTED RATHER THAN GUESSED. A run with
 * no winning trades has no `avgWinPct`, so the equation has no solution — "you cannot break even"
 * and "I cannot compute it" are different statements, and the first is not provable from a sample
 * that contains no wins.
 */

export interface TradeOutcomeInput {
  /** Every trade's `pnlPct` — net of spread, slippage and commission, as a % of entry cost. */
  pnlPcts: number[];
}

export type BreakEvenUnavailable = 'no-trades' | 'no-wins' | 'no-losses';

export interface BreakEvenResult {
  /** Mean `pnlPct` of the winning trades, as a percentage. NULL when there were none. */
  avgWinPct: number | null;
  /** Mean |`pnlPct`| of the losing trades, as a percentage. NULL when there were none. */
  avgLossPct: number | null;
  /** The win rate needed to break even, as a PERCENTAGE (74.9 = 74.9%). NULL = cannot judge. */
  requiredWinRatePct: number | null;
  /** Why it is null, when it is. Named, never implied. */
  unavailable: BreakEvenUnavailable | null;
  /** achieved − required, in percentage points. The number to act on. */
  gapPp: number | null;
  /** TRUE when the achieved win rate clears the bar. NULL when it cannot be judged. */
  profitable: boolean | null;
  /** The two counts the averages rest on, so a reader can judge how thin the sample is. */
  wins: number;
  losses: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param achievedWinRatePct the run's own trade win rate as a PERCENTAGE (42.3 = 42.3%).
 */
export function breakEvenFromOutcomes(
  input: TradeOutcomeInput,
  achievedWinRatePct: number | null,
): BreakEvenResult {
  const pnls = (input?.pnlPcts ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (!pnls.length) {
    return {
      avgWinPct: null, avgLossPct: null, requiredWinRatePct: null,
      unavailable: 'no-trades', gapPp: null, profitable: null, wins: 0, losses: 0,
    };
  }

  const winPcts = pnls.filter((p) => p > 0);
  const lossPcts = pnls.filter((p) => p <= 0).map((p) => Math.abs(p));

  const avgWinPct = winPcts.length ? round2(winPcts.reduce((a, b) => a + b, 0) / winPcts.length) : null;
  const avgLossPct = lossPcts.length ? round2(lossPcts.reduce((a, b) => a + b, 0) / lossPcts.length) : null;

  // ⚠️ A ONE-SIDED RUN HAS NO SOLUTION. Saying "0%" or "100%" would be a fabricated answer to a
  // question the sample cannot address; the reason is returned instead.
  if (avgWinPct == null) {
    return {
      avgWinPct: null, avgLossPct, requiredWinRatePct: null,
      unavailable: 'no-wins', gapPp: null, profitable: null, wins: 0, losses: lossPcts.length,
    };
  }
  if (avgLossPct == null) {
    return {
      avgWinPct, avgLossPct: null, requiredWinRatePct: null,
      unavailable: 'no-losses', gapPp: null, profitable: null, wins: winPcts.length, losses: 0,
    };
  }

  const requiredWinRatePct = round1((avgLossPct / (avgWinPct + avgLossPct)) * 100);

  // ⚠️ `Number(null)` IS 0, so a null achieved rate would read as "0% achieved" and produce a
  // confident negative gap. The null check has to happen BEFORE the conversion.
  const achieved =
    achievedWinRatePct == null || (achievedWinRatePct as unknown) === ''
      ? NaN
      : Number(achievedWinRatePct);
  // ⚠️ FROM THE ROUNDED REQUIREMENT, so `achieved − required = gap` holds against the numbers a
  // reader can see. A trio that fails its own subtraction invites doubt about all three.
  const gapPp = Number.isFinite(achieved) ? round1(achieved - requiredWinRatePct) : null;

  return {
    avgWinPct,
    avgLossPct,
    requiredWinRatePct,
    unavailable: null,
    gapPp,
    // A gap of exactly 0 is break-even BEFORE variance, not profit. `>` and not `>=`.
    profitable: gapPp == null ? null : gapPp > 0,
    wins: winPcts.length,
    losses: lossPcts.length,
  };
}

/**
 * `medianBracket()` — the stop/target the trades actually carried, for DISPLAY only.
 *
 * ⚠️ IT IS NO LONGER PART OF THE BREAK-EVEN CALCULATION (see the file header: using it there is what
 * double-counted the cost). It survives because "what bracket did this run use?" is a fair question
 * and the answer is not otherwise recoverable — `slPct`/`tpPct` are not stored on the run, and the
 * bot's CURRENT values may have been retuned since.
 *
 * ⚠️ THE DISTANCES ARE MEASURED FROM `entryPrice`, WHICH ALREADY CARRIES THE ENTRY COST, so a long's
 * recorded stop distance reads slightly WIDER than its nominal `slPct` and its target slightly
 * NARROWER. That is what the trade actually had — but it is not the number an operator typed, and it
 * must not be presented as one.
 */
export function medianBracket(
  trades: Array<{ entryPrice?: number | string | null; stopLoss?: number | string | null; takeProfit?: number | string | null }> | null | undefined,
): { stopPct: number | null; targetPct: number | null; sample: number } {
  const stops: number[] = [];
  const targets: number[] = [];
  for (const t of trades ?? []) {
    const e = Number(t.entryPrice);
    const s = Number(t.stopLoss);
    const p = Number(t.takeProfit);
    if (!(e > 0) || !(s > 0) || !(p > 0)) continue;
    stops.push(Math.abs((e - s) / e) * 100);
    targets.push(Math.abs((p - e) / e) * 100);
  }
  if (!stops.length) return { stopPct: null, targetPct: null, sample: 0 };
  const med = (a: number[]) => {
    const sorted = [...a].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { stopPct: round2(med(stops)), targetPct: round2(med(targets)), sample: stops.length };
}
