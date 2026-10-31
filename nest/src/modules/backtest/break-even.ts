/**
 * break-even.ts — HOW OFTEN A BRACKET MUST WIN to pay for itself, and the gap to what it actually won.
 *
 * ── THE QUESTION THIS ANSWERS (2026-10-31) ──────────────────────────────────────────────────────
 * Every "why do the strategies lose?" answer in this repo had been a story: stops too far, entries
 * mistimed, costs too high. All guessable, none checkable. The arithmetic is checkable, and measured
 * across the stored runs it is decisive:
 *
 *   run        stop   target  cost   achieved  needs    gap
 *   1bbf1860   2.49%   1.49%  1.01%    42.3%   88.0%   −45.7pp
 *   568c5552   2.47%   3.50%  0.97%    22.9%   57.7%   −34.8pp
 *   6f8fc678   2.50%   3.47%  1.02%    22.9%   59.0%   −36.1pp
 *
 * Two different failures, both invisible before this number existed:
 *   1. A target SMALLER than the stop (1.49% vs 2.49%) needs an **88%** win rate. No stop-tuning,
 *      trailing rule or directive set realistically reaches that — the bracket is structurally
 *      unprofitable and the only fix is to change the bracket.
 *   2. Even a 1.4:1 bracket needs 58% and the engine achieves 23%. So the bracket is not the whole
 *      story either: the ENTRIES are not predicting direction well enough.
 *
 * ── THE ARITHMETIC ──────────────────────────────────────────────────────────────────────────────
 * A trade risks `stopPct` and returns `targetPct`, and pays `costPct` (spread + both slippage legs)
 * whichever way it goes. Expectancy per trade, as a percentage of entry:
 *
 *     E(p) = p·(target − cost) + (1 − p)·(−stop − cost)
 *
 * Setting E = 0 and solving:
 *
 *     p·target − p·cost − stop + p·stop − cost + p·cost = 0
 *     p·(target + stop) = stop + cost                     ← the ±p·cost terms cancel
 *     p = (stop + cost) / (target + stop)
 *
 * ⚠️ THE COST CANCELS OUT OF THE DENOMINATOR AND SURVIVES IN THE NUMERATOR, which is why a small
 * cost moves the required win rate so far: at a 2.5/1.5 bracket it is +25 percentage points of win
 * rate for a 1 percentage point of cost. That is the opposite of the intuition "costs are small".
 *
 * ⚠️ UNITS. `stopPct`, `targetPct` and `costPct` are ALL percentages of entry price (2.5 = 2.5%).
 * `spread`/`slippage` are stored as FRACTIONS (0.0093 = 0.93%), so the caller converts — and this
 * function takes the converted figure so there is exactly one conversion in the app.
 */

export interface BreakEvenInput {
  /** Distance from entry to the stop, as a PERCENTAGE of entry (2.5 = 2.5%). */
  stopPct: number | null;
  /** Distance from entry to the target, as a PERCENTAGE of entry. */
  targetPct: number | null;
  /** Round-trip cost as a PERCENTAGE of entry — spread + 2 × slippage, already ×100. */
  costPct: number | null;
}

export interface BreakEvenResult {
  /** The win rate this bracket needs, as a PERCENTAGE (57.7 = 57.7%). NULL = cannot judge. */
  requiredWinRatePct: number | null;
  /** Why it is null, when it is. Named rather than implied. */
  unavailable: 'no-bracket' | 'target-below-cost' | null;
  /** achieved − required, in percentage points. NULL when either side is unknown. */
  gapPp: number | null;
  /** TRUE when the achieved win rate clears the bar. NULL when it cannot be judged. */
  profitable: boolean | null;
}

/**
 * @param achievedWinRatePct the run's own trade win rate as a PERCENTAGE (22.9 = 22.9%).
 */
export function breakEvenWinRate(
  input: BreakEvenInput,
  achievedWinRatePct: number | null,
): BreakEvenResult {
  const stop = Number(input.stopPct);
  const target = Number(input.targetPct);
  const cost = Number(input.costPct);

  // A bracket needs BOTH legs. Without them there is nothing to solve, and 0 would be a claim that
  // every trade must win.
  if (!Number.isFinite(stop) || !Number.isFinite(target) || stop <= 0 || target <= 0) {
    return { requiredWinRatePct: null, unavailable: 'no-bracket', gapPp: null, profitable: null };
  }
  const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0;

  // ⚠️ A TARGET THAT DOES NOT COVER THE COST CANNOT BREAK EVEN AT ANY WIN RATE. The formula would
  // still return a number (just above 100%), and printing "104% needed" invites a reader to try to
  // reach it. Naming the real reason is the honest answer.
  if (target <= safeCost) {
    return { requiredWinRatePct: null, unavailable: 'target-below-cost', gapPp: null, profitable: null };
  }

  const required = ((stop + safeCost) / (target + stop)) * 100;
  const requiredWinRatePct = Math.round(required * 10) / 10;
  // ⚠️ `Number(null)` IS 0, so a null achieved rate would read as "0% achieved" and produce a
  // confident −58.3pp gap. The null check has to happen BEFORE the conversion.
  const achieved =
    achievedWinRatePct == null || (achievedWinRatePct as unknown) === ''
      ? NaN
      : Number(achievedWinRatePct);
  // ⚠️ THE GAP IS COMPUTED FROM THE ROUNDED REQUIREMENT, not the raw one. A reader checks
  // `achieved − required = gap` against the three numbers on screen; deriving the gap from an
  // unrounded value makes the displayed trio disagree by 0.1pp, and a number that fails its own
  // arithmetic invites doubt about all three.
  const gapPp = Number.isFinite(achieved)
    ? Math.round((achieved - requiredWinRatePct) * 10) / 10
    : null;

  return {
    requiredWinRatePct,
    unavailable: null,
    gapPp,
    // ⚠️ A gap of exactly 0 is NOT profitable: it is break-even before any variance. `>` not `>=`.
    profitable: gapPp == null ? null : gapPp > 0,
  };
}

/**
 * The median bracket a run's trades actually used, from the levels recorded ON the trades.
 *
 * ⚠️ MEASURED FROM THE TRADES, NOT FROM THE REQUEST. The request's `slPct`/`tpPct` are not stored on
 * the run, and a stored run's bracket cannot be recovered from anything else — while every trade
 * carries the `stopLoss`/`takeProfit` the engine actually used (since #R14). Median rather than mean
 * because one trade with a widened stop should not move the number a reader acts on.
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
  return {
    stopPct: Math.round(med(stops) * 100) / 100,
    targetPct: Math.round(med(targets) * 100) / 100,
    sample: stops.length,
  };
}
