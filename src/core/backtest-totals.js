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
 * ⚠️ IT PREFERS THE RECORDED LOOP (#1144). Runs now carry `experimentId` + `iteration`, so the honest
 * pair is "the first and last iteration of the SAME experiment on this window" — that is what the change
 * under test actually was. Before this, the choice was `createdAt` order, i.e. a GUESS that two runs
 * were consecutive attempts because they happened to sit next to each other.
 *
 * Fallback order (each step runs only when the previous cannot produce a pair):
 *
 *   1. an experiment on this window with two or more usable runs → lowest and highest `iteration`;
 *   2. otherwise oldest and newest by `createdAt`, and the result SAYS it was inferred (`basis`), because
 *      a guessed pair must not read like a recorded one.
 *
 * ⚠️ RUNS WITH NO STORED SCORES ARE SKIPPED WHEN THE FLAG IS KNOWN (`hasScores === false`). Measured
 * 2026-10-27: the oldest run of `dev-window-v1` predates the score series, so pairing it produced
 * "cannot be compared" on a window that had two perfectly good runs beside it.
 *
 * ⚠️ AND SO ARE RUNS WITH NO PER-BAR INSTANT (`hasInstants === false`) — a different flag for a
 * different gap. A run stored before the series recorded `time` HAS scores, so `hasScores` cannot
 * exclude it, and pairing it made the window report "a run stored no per-bar instant, so the two
 * cannot be lined up" while measurable runs sat unused on the same period (measured on
 * `dev-window-v1`, where the oldest run with scores was exactly that kind).
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

  // 1. A recorded loop on this window — the only pair that is a fact rather than an inference.
  const byExperiment = new Map();
  for (const r of onPeriod) {
    if (!r.experimentId || r.iteration == null) continue;
    const list = byExperiment.get(r.experimentId) ?? [];
    list.push(r);
    byExperiment.set(r.experimentId, list);
  }
  /**
   * WHICH loop, when a window has more than one? ⚠️ THE MOST RECENTLY ACTIVE ONE, not the longest.
   *
   * A window can be revisited weeks later (a new attempt at the same dates), so "the loop with the most
   * runs" would keep pointing at last week's abandoned attempt while today's sits beside it. Recency is
   * what a reader means by "the attempt being examined"; the count breaks ties, and the chosen
   * `experimentId` is returned so the panel can say WHICH loop it picked rather than implying there was
   * only one.
   */
  const newest = (list) =>
    list.reduce((m, r) => Math.max(m, new Date(r.createdAt ?? 0).getTime()), 0);
  const loops = [...byExperiment.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => newest(b[1]) - newest(a[1]) || b[1].length - a[1].length);
  if (loops.length > 0) {
    const [experimentId, list] = loops[0];
    const byIteration = [...list].sort((x, y) => x.iteration - y.iteration);
    return {
      pair: {
        aId: byIteration[0].id,
        bId: byIteration[byIteration.length - 1].id,
        n: byIteration.length,
        basis: 'experiment',
        experimentId,
        fromIteration: byIteration[0].iteration,
        toIteration: byIteration[byIteration.length - 1].iteration,
      },
      reason: null,
    };
  }

  // 2. No loop recorded — say so in the result, so the pair is not read as a recorded attempt.
  const byTime = [...onPeriod].sort(
    (x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
  );
  return {
    pair: {
      aId: byTime[0].id,
      bId: byTime[byTime.length - 1].id,
      n: byTime.length,
      basis: 'created-order',
    },
    reason: null,
  };
}
