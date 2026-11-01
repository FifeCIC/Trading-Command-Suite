/**
 * lookahead.ts — "was this data already true at the evaluated bar?", as a pure decision.
 * ====================================================================================
 *
 * ── DECISION (2026-11-01, primary) ──
 * WHAT:      A directive that cannot answer for a HISTORICAL bar must ABSTAIN (`unmeasured`), never
 *            score a current snapshot. Lookahead is tested exactly — observed-after-evaluated, with one
 *            BAR DURATION as the only tolerance — and a missing timestamp is `unknown`, which abstains.
 * WHY:       #1139 item 2. `crypto-fear-greed` fetched a live index and `dilution-impact` read one
 *            current `companyMetric` row, so every historical bar was scored against today's value in
 *            both cases — plausibly and with no error. A protocol using either could not be judged by
 *            its backtest at all.
 * INSTEAD OF: A fixed tolerance (days/hours), which either flags every live bar — a relative offset of
 *            zero is wrong because a bar is stamped at its OPEN — or admits three-day-old data.
 * REVERSE BY: Deleting the guard from both directives. Nothing is stored or migrated, so reversal is a
 *            pure code revert (and it would restore the fabrication, which is why it was a defect).
 * REGISTER:  docs/SETTLED-DECISIONS.md row 112
 * GUARD:     nest/src/modules/directives/lookahead.spec.ts + implementations/lookahead-directives.spec.ts
 *
 * #1139 item 2. Two directives score a **current snapshot** on every historical bar:
 *
 *   `crypto-fear-greed` — fetches `api.alternative.me/fng` with a 1-hour cache, never reads `asOf`
 *   `dilution-impact`   — `companyMetric.findUnique({ where: { symbol } })`, a current row, no date predicate
 *
 * In a backtest every bar is therefore scored against **today's** value. The number is plausible and
 * nothing errors — this repo's signature failure. A protocol using either cannot be judged by its
 * backtest at all.
 *
 * ── THE TEST IS EXACT, NOT A GUESSED TOLERANCE ───────────────────────────────────────────────────
 * Lookahead has a precise definition: **the data was observed AFTER the moment being evaluated.**
 * Both sources carry the fact needed to check it — `crypto-fear-greed` keeps `fetchedAt`, and
 * `companyMetric` has a `fetchedAt` column (verified with `db-schema.cjs`). So the test is a
 * comparison of two timestamps, not a heuristic.
 *
 * ── WHY THERE IS STILL A TOLERANCE, AND WHY IT IS NOT ARBITRARY ─────────────────────────────────
 * A live bar's timestamp is its **open**, and data legitimately arrives *during* the bar. With a zero
 * tolerance, live scoring would be flagged as lookahead constantly: a 1h bar opening at 14:00 scored
 * at 14:30 has data observed after 14:00. So the tolerance is **one bar duration**, taken from the
 * timeframe being scored — the window in which data for that bar is allowed to arrive.
 *
 * That makes the check correct in both directions without a magic constant:
 *   live 1h bar, fetched 30m after open  → 30m ≤ 1h  → ok
 *   1h bar from 3 days ago, cached now   → 72h > 1h  → lookahead
 */

import type { DirectiveResult } from './interfaces/directive.interface';

export type Fidelity = 'ok' | 'lookahead' | 'unknown';

/** One bar, in milliseconds. Unknown timeframes are treated as 1 day — the coarsest common case. */
export function timeframeToMs(timeframe: string | undefined): number {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  switch ((timeframe ?? '').trim().toLowerCase()) {
    case '1m': return MIN;
    case '5m': return 5 * MIN;
    case '15m': return 15 * MIN;
    case '30m': return 30 * MIN;
    case '1h': case '60m': return HOUR;
    case '4h': return 4 * HOUR;
    case '1d': case 'd': return DAY;
    case '1w': case 'w': return 7 * DAY;
    default: return DAY;
  }
}

function toMs(v: Date | number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
}

/**
 * @param observedAt     when the data we are about to use was observed
 * @param evaluationAt   the bar being evaluated (`input.asOf`)
 * @param timeframe      the cadence of that bar, which sets the arrival allowance
 */
export function checkFidelity(
  observedAt: Date | number | string | null | undefined,
  evaluationAt: Date | number | string | null | undefined,
  timeframe: string | undefined,
): Fidelity {
  const observed = toMs(observedAt);
  const evaluated = toMs(evaluationAt);
  // ⚠️ Either timestamp missing is UNKNOWN, not OK. "I cannot prove this was available" must not be
  // recorded as "it was available" — that is the direction that fabricates a reading.
  if (observed === null || evaluated === null) return 'unknown';
  return observed > evaluated + timeframeToMs(timeframe) ? 'lookahead' : 'ok';
}

/**
 * The standard "cannot judge" result for a source that cannot be time-filtered.
 *
 * Follows the pattern already used by `analyst-adjustments-honesty.spec.ts`: score 0, no direction,
 * `unmeasured: true`, and a reason that says UNMEASURED in capitals so a reader cannot mistake it for
 * a weak reading. Risk gating already ignores `unmeasured` results.
 */
export function lookaheadResult(
  what: string,
  observedAt: Date | number | string | null | undefined,
  evaluationAt: Date | number | string | null | undefined,
  detail: string,
): DirectiveResult {
  const observed = toMs(observedAt);
  const evaluated = toMs(evaluationAt);
  const when = observed !== null ? new Date(observed).toISOString().slice(0, 16).replace('T', ' ') : 'unknown time';
  const at = evaluated !== null ? new Date(evaluated).toISOString().slice(0, 16).replace('T', ' ') : 'unknown time';
  return {
    score: 0,
    confidence: 0,
    signalClass: 'neutral',
    unmeasured: true,
    reason:
      `UNMEASURED — ${what} was observed at ${when} (UTC), after the bar being evaluated at ${at} (UTC). `
      + `${detail} This is lookahead: the bar is scored against data that did not exist yet, so the `
      + `result is not evidence.`,
  };
}
