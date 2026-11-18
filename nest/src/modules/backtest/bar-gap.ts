/**
 * Bar-gap detection — "was the bracket unmonitored between these two bars?"
 *
 * Extracted from the trade loop in `backtest.service.ts` so the threshold has a single definition
 * and a test that can fail (#1286).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The machine sleeps. Owner directive: Sometimes the PC is shutdown while positions are open so some of our
 * data could be skewed by the app being asleep. When the bar series has a hole, no bar exists to
 * test a stop or target against, so the exit reason recorded for a trade that crossed the hole is a
 * GUESS — the level that would have fired inside the hole was never seen.
 *
 * The trade still exits at a real price, so its P&L is a real measurement of what the engine did.
 * The `spansGap` flag does not discard the trade; it lets a run report how much of its population
 * is contaminated instead of quietly averaging over it.
 *
 * ── THE THRESHOLD, STATED EXACTLY ───────────────────────────────────────────────────────────────
 * A pair of consecutive bars is a HOLE when the step between them exceeds BOTH:
 *
 *   • `barMinutes * 12` — twelve bars' worth, so a single missing bar is not a hole; and
 *   • `60` minutes — an absolute floor, so a fast chart does not flag every hiccup.
 *
 * ⚠️ For a 5m chart both reduce to `> 60 min`, which is why the original comment said "a hole > 1h".
 * That is NOT true in general: on a 1h chart the floor is `> 720 min` (12 hours). Behaviour is
 * unchanged here — this note exists because the old comment described the 5m case as if it were
 * universal.
 */

/** Minutes in a millisecond step. */
const MS_PER_MIN = 60_000;

function finite(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * TRUE when the step between two consecutive bars is long enough to count as an unmonitored hole.
 *
 * Returns FALSE for any non-finite input rather than guessing: an unmeasurable gap must not be
 * reported as `spansGap = true`, because that excludes the trade's excursion from the usable
 * population. Not-flagged is the safer default — see `ExcursionTotals` in `score-maths.ts`.
 */
export function isBarHole(stepMs: unknown, barMinutes: unknown): boolean {
  const step = finite(stepMs);
  const bar = finite(barMinutes);
  if (step === null || bar === null) return false;
  if (step <= 0 || bar <= 0) return false;
  const stepMin = step / MS_PER_MIN;
  return stepMin > bar * 12 && stepMin > 60;
}
