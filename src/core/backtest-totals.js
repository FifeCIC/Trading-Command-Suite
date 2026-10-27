/**
 * backtest-totals — the ONE thing the client still owns about A/B comparison: WHICH RUNS to offer.
 * =================================================================================================
 *
 * ⚠️ THE ARITHMETIC MOVED TO THE API (2026-10-27). The sums, the highest/lowest bar, the up/down/same
 * counts and the "did it repeat" verdict now live in `nest/src/modules/backtest/score-maths.ts` and are
 * served by `POST /api/backtest/repeat-check` and the `totals` block on `GET /api/backtest/results/:id`.
 *
 * WHY THEY MOVED: the owner's stated goal is *"agentic AI being able to use it … make adjustments,
 * re-test, and keep doing that over and over"*. A tuning loop's DECISION has to be reachable without a
 * browser. Keeping a JavaScript copy here meant an agent either could not decide at all, or decided
 * with a second implementation that would drift from the UI's — and this page has already paid for one
 * such divergence (a date-keyed join that reported 954 of 1,722 identical bars as "changed").
 *
 * ⚠️ SO DO NOT RE-ADD THE MATHS HERE. If a panel needs a number, ask whether the API should return it;
 * if it needs to render bars the client already holds, that is presentation and belongs in the panel.
 *
 * What remains is selection: which two runs of a window stand in as that window's A and B. That is a UI
 * decision, has no counterpart in the engine, and is tested in `backtest-totals.test.js`.
 */

/**
 * pickRepeatPair — the SECOND window's A and B, chosen deterministically.
 *
 * The oldest run of the period is treated as that window's "A" and the newest as its "B": within one
 * window that is exactly the order in which a change was tried. The caller prints both ids so a reader
 * (or an agent reading the panel) can see which runs a verdict was built from.
 *
 * ⚠️ RUNS WITH NO STORED SCORES ARE SKIPPED WHEN THE FLAG IS KNOWN (`hasScores === false`). Measured
 * 2026-10-27: the oldest run of `dev-window-v1` predates the score series, so pairing it produced
 * "cannot be compared" on a window that had two perfectly good runs beside it.
 *
 * ⚠️ AND SO ARE RUNS WITH NO PER-BAR INSTANT (`hasInstants === false`) — a different flag for a
 * different gap. A run stored before the series recorded `time` HAS scores, so `hasScores` cannot
 * exclude it, and pairing it made the window report "a run stored no per-bar instant, so the two
 * cannot be lined up" while measurable runs sat unused on the same period (measured on
 * `dev-window-v1`, where the oldest run with scores was exactly that kind). Skipping it here means the
 * window is measured rather than explained.
 */
export function pickRepeatPair(runs, period, excludeIds = []) {
  const onPeriod = (runs ?? []).filter(
    (r) =>
      r.period === period &&
      !excludeIds.includes(r.id) &&
      r.hasScores !== false &&
      r.hasInstants !== false,
  );
  if (onPeriod.length < 2) {
    return { pair: null, reason: 'that window has fewer than two stored runs that can be lined up bar by bar' };
  }
  const byTime = [...onPeriod].sort(
    (x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
  );
  return { pair: { aId: byTime[0].id, bId: byTime[byTime.length - 1].id, n: byTime.length }, reason: null };
}
