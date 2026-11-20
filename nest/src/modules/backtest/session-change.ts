/**
 * session-change.ts — "% change today" for a bar in a historical run.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * The owner's question on 2026-11-20 was "our data has a 430% changer but the strategy wins 36% of
 * its trades — why?". Answering it needs, per bar, the move the RANKER measured (close against the
 * previous SESSION's close), beside the score that decided the trade. The run's `scoreSeries` carried
 * the score but not the price and not the move, so the two numbers a reader needs to compare were the
 * two the record did not keep.
 *
 * ⚠️ THE DENOMINATOR IS THE PREVIOUS SESSION'S CLOSE, NOT THE PREVIOUS BAR'S. A per-bar change resets
 * to 0% at every new session, so a +430% day reads as a string of small moves and cannot be compared
 * with the number a movers screen shows. `selection-ranking.moveSoFarPct()` uses the same denominator
 * for the same reason — this tracker exists so the run's per-bar figure agrees with the ranker's,
 * rather than being a second convention that drifts.
 *
 * ⚠️ NULL IS NOT 0. The first session in a window has no earlier close to measure from, so it reports
 * `null` and the caller renders "—". Reporting 0% there would make an unmeasurable bar look flat.
 *
 * Pure and stateful only in its closure: no Prisma, no clock, so every branch is testable.
 */

export type SessionChangeFn = (isoTimestamp: string, close: number) => number | null;

/**
 * Build a tracker for one run's bars. Feed it every bar **in ascending time order**; it returns the
 * change against the previous session's last close, or `null` for the first session.
 */
export function createSessionChangeTracker(): SessionChangeFn {
  let currentDate: string | null = null;
  let lastCloseOfDate: number | null = null;
  let previousSessionClose: number | null = null;

  return (isoTimestamp: string, close: number): number | null => {
    const date = String(isoTimestamp).slice(0, 10);
    if (date !== currentDate) {
      // A new session: the close we have accumulated for the OLD one becomes the denominator.
      previousSessionClose = lastCloseOfDate;
      currentDate = date;
    }

    const usable =
      previousSessionClose !== null &&
      Number.isFinite(previousSessionClose) &&
      previousSessionClose > 0 &&
      Number.isFinite(close);

    // The denominator is updated AFTER the measurement, so the bar that ends a session is still
    // measured against the session before it.
    const pct = usable ? (close / (previousSessionClose as number) - 1) * 100 : null;
    lastCloseOfDate = close;
    return pct;
  };
}
