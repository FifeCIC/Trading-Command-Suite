/**
 * backtest-compare — "is this number better or worse than the last run?" in ONE place.
 * ==========================================================================================
 *
 * Owner direction, 2026-10-30: *"Lets style these boxes with a colour to indicate improvement or not:
 * based on the previous test if one was done for that strategy … it might be that the box borders are
 * coloured based on comparison but the text for loss or profit is standard red and green."*
 *
 * TWO ENCODINGS, ON PURPOSE, AND THEY ANSWER DIFFERENT QUESTIONS:
 *   · the VALUE keeps its profit/loss colour  → "where does this run stand?"
 *   · the BORDER carries the comparison       → "did the change help?"
 * A single colour cannot do both. A −5% P&L on a run that improved from −12% is a loss AND an
 * improvement, and painting the number green would say it made money.
 *
 * ⚠️ THIS IS NOT ARITHMETIC OVER A RUN. It compares two numbers the SERVER already computed, and it
 * never re-derives a total — the standing rule in `backtest-totals.js` is against a second
 * implementation of the totals, not against reading their sign. Even so, every comparison here is
 * reported as better/worse/unknown and never as a quantity: the panel shows the two runs' own figures
 * and this module only says which way the arrow points.
 *
 * ⚠️ `unknown` IS A REAL STATE AND IS NEVER PAINTED AS `same`. No previous run, a metric the engine
 * did not record, or a pair that is not comparable all mean "cannot judge" — and the run that renders
 * as "no change" when it was never compared is the defect this file exists to avoid.
 */

/** Which direction is an improvement, per metric. */
export const HIGHER_IS_BETTER = 'higher';
export const LOWER_IS_BETTER = 'lower';

/**
 * The trade-tile and stats-grid metrics, with their direction and where the number lives.
 *
 * ⚠️ A metric with a NEGATIVE sign convention is listed explicitly: `maxTradeDrawdown` is the worst
 * single trade's P&L, so −5 % is WORSE than −2 %. Marking it `higher` is what makes the arrow point the
 * right way; marking it `lower` because the word "drawdown" sounds bad would invert every one of them.
 *
 * ⚠️ `maxReturn10d` / `maxDrawdown10d` are a BEST/WORST pair of ten-day FORWARD RETURNS, not a
 * drawdown (#1149 follow-up, 2026-10-30). The labels say "Best"/"Worst return" for that reason:
 * "drawdown" on this page now means the equity path and nothing else, because two different numbers
 * once carried the name — 8,867.70% for the path and −2.87% for the forward return, side by side.
 */
export const TRADE_METRICS = {
  count: { label: 'Closed trades', better: HIGHER_IS_BETTER },
  winRatePct: { label: 'Win rate', better: HIGHER_IS_BETTER },
  sumPnl: { label: 'Σ P&L', better: HIGHER_IS_BETTER },
  avgPnlPct: { label: 'Avg per trade', better: HIGHER_IS_BETTER },
  avgBarsHeld: { label: 'Avg hold (bars)', better: LOWER_IS_BETTER },
  avgHoldMinutes: { label: 'Avg hold (clock)', better: LOWER_IS_BETTER },
};

export const RUN_METRICS = {
  totalSignals: { label: 'Entry signals', better: HIGHER_IS_BETTER },
  winRate: { label: 'Entry signals profitable', better: HIGHER_IS_BETTER },
  averageReturn10d: { label: 'Avg return 10d', better: HIGHER_IS_BETTER },
  maxReturn10d: { label: 'Best return 10d', better: HIGHER_IS_BETTER },
  maxDrawdown10d: { label: 'Worst return 10d', better: HIGHER_IS_BETTER },
  profitFactor: { label: 'Profit factor', better: HIGHER_IS_BETTER },
  sharpeApproximation: { label: 'Sharpe (approx)', better: HIGHER_IS_BETTER },
  totalTrades: { label: 'Bracket trades', better: HIGHER_IS_BETTER },
  tradeWinRate: { label: 'Trade win rate', better: HIGHER_IS_BETTER },
  avgTradePnl: { label: 'Avg trade P&L', better: HIGHER_IS_BETTER },
  totalPnl: { label: 'Total P&L', better: HIGHER_IS_BETTER },
  grossPnl: { label: 'Gross P&L', better: HIGHER_IS_BETTER },
  totalCommission: { label: 'Total commission', better: LOWER_IS_BETTER },
  avgPositionSize: { label: 'Avg position size', better: HIGHER_IS_BETTER },
  maxTradeDrawdown: { label: 'Worst trade', better: HIGHER_IS_BETTER },
};

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Compare one metric against its previous value.
 *
 * Returns `{ verdict, prev, next }` where verdict is:
 *   'better' | 'worse' | 'same' | 'unknown'
 *
 * ⚠️ TOLERANCE IS RELATIVE, NOT ABSOLUTE. A win rate of 22.9 % and one of 22.9000001 % are the same
 * number stored at different precision, and an absolute epsilon would report them as an improvement on
 * one run and a regression on the next depending on rounding. 0.5 % of the larger magnitude is small
 * enough to catch float noise and large enough that a real move of a tenth of a percent still shows.
 */
export function compareMetric(prev, next, better = HIGHER_IS_BETTER) {
  const a = finite(prev);
  const b = finite(next);
  if (a == null || b == null) return { verdict: 'unknown', prev: a, next: b };
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  const tol = scale * 0.005;
  if (Math.abs(b - a) <= tol) return { verdict: 'same', prev: a, next: b };
  const improved = better === LOWER_IS_BETTER ? b < a : b > a;
  return { verdict: improved ? 'better' : 'worse', prev: a, next: b };
}

/**
 * Compare a whole object of metrics (a run's `stats` or its `tradeTotals`).
 *
 * Returns `{ [key]: verdict }` including 'unknown' for every metric the specification names but the
 * payloads do not carry — so the caller can render "not compared" rather than silently leaving a
 * box uncoloured for two different reasons.
 */
export function compareMetrics(spec, prevObj, nextObj) {
  const out = {};
  for (const [key, meta] of Object.entries(spec)) {
    out[key] = compareMetric(prevObj?.[key], nextObj?.[key], meta.better).verdict;
  }
  return out;
}

/**
 * The CSS modifier for a verdict. Empty string for 'unknown' and 'same' — an uncoloured box is the
 * honest rendering of "we did not compare" and of "nothing moved", and both differ from a verdict.
 */
export const verdictClass = (verdict) => (verdict === 'better' || verdict === 'worse' ? `is-${verdict}` : '');

/**
 * Why a comparison is unavailable, in words — or null when there IS a previous run to compare with.
 *
 * ⚠️ THE CALLER MUST PRINT THIS WHEN THERE IS NO COLOUR. "No previous run" and "the previous run is a
 * different configuration" are different answers, and an unlabelled row of uncoloured boxes reads as
 * "nothing changed" under either.
 */
export function noComparisonReason({ previousRunId, previousRunMissing, incomparable }) {
  if (incomparable) return incomparable;
  if (previousRunMissing) return 'the previous run no longer exists — it was deleted, so nothing was compared';
  if (!previousRunId) return 'this is the first stored run for this strategy, so there is nothing to compare against yet';
  return null;
}
