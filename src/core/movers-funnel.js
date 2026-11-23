/**
 * movers-funnel.js — SCORES → SIGNALS → TRADES, counted from the engine's own per-bar verdicts.
 *
 * ── WHY THE LOGIC IS SEPARATE FROM THE STEP (#1344) ─────────────────────────────────────────────
 * The step renders; these functions decide what a number means. A `.jsx` file cannot be run by
 * `node --test` (unknown extension), and the numbers here are the ones a reader will quote, so the
 * counting lives where it can be asserted without a browser — the same split `best-record.js` and
 * `backtest-unused-fields.js` already use.
 *
 * ── ⚠️ THE VOCABULARY IS THE ENGINE'S ───────────────────────────────────────────────────────────
 * `bar.state` is produced by the backtest run, and `MoversDepthPanel` renders the same value. Adding a
 * bucket here without adding it there would leave one surface counting a bar the other cannot show, so
 * the states are declared once, below, and an UNKNOWN state is deliberately counted into no bucket
 * rather than dropped silently into "quiet".
 */

/** The per-bar verdicts the engine emits. Kept in step with `MoversDepthPanel`'s own state labels. */
export const BAR_STATES = Object.freeze([
  'no-data',
  'quiet',
  'bar-gate',
  'signal-not-traded',
  'entry',
  'entry+exit',
]);

/** The protocol directive that rates price SPEED — 5-bar rate of change, amplified by volume. */
export const SPEED_DIRECTIVE = 'speed-momentum';

const countState = (bars, state) => bars.filter((b) => b?.state === state).length;

/** The speed directive's own reading for one symbol, or `present: false` when no breakdown was recorded. */
export function speedOf(bars) {
  const found = (Array.isArray(bars) ? bars : [])
    .map((b) => (b?.directives ?? []).find((d) => d && d.directiveId === SPEED_DIRECTIVE))
    .filter((d) => d && typeof d.score === 'number');
  if (found.length === 0) return { present: false, mean: null, peak: null, maxScore: null, bars: 0 };
  const scores = found.map((d) => d.score);
  return {
    present: true,
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    peak: Math.max(...scores),
    maxScore: found[0].maxScore ?? null,
    bars: found.length,
  };
}

/** One row of the funnel for one (day, symbol). Pure. */
export function funnelFor(symbol, detail, day = null) {
  const bars = Array.isArray(detail?.bars) ? detail.bars : [];
  const trades = Array.isArray(detail?.trades) ? detail.trades : [];
  return {
    symbol,
    day: day ?? detail?.day ?? null,
    scored: bars.length,
    noData: countState(bars, 'no-data'),
    quiet: countState(bars, 'quiet'),
    barGate: countState(bars, 'bar-gate'),
    signalNotTraded: countState(bars, 'signal-not-traded'),
    /**
     * ⚠️ A SAME-BAR ENTRY AND EXIT IS ONE TRADED BAR. Counting `entry` and `entry+exit` as two would
     * inflate the denominator of every rate on this step, and the bar list would still look right.
     */
    entered: bars.filter((b) => b?.state === 'entry' || b?.state === 'entry+exit').length,
    trades: trades.length,
    speed: speedOf(bars),
  };
}

/** The funnel's own denominator, so no percentage is printed without one. */
export function funnelTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sum = (k) => list.reduce((a, r) => a + Number(r?.[k] ?? 0), 0);
  return {
    scored: sum('scored'),
    noData: sum('noData'),
    quiet: sum('quiet'),
    barGate: sum('barGate'),
    signalNotTraded: sum('signalNotTraded'),
    entered: sum('entered'),
    trades: sum('trades'),
  };
}

/** `12.5%`, or `—` when there is no denominator — never `NaN%` and never `0%` for "no bars". */
export function sharePct(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return '—';
  return `${((p / w) * 100).toFixed(1)}%`;
}

/** The directives this protocol actually scored, from the run's own bars — never from a name list. */
export function protocolDirectiveIds(entries) {
  const ids = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const b of e?.detail?.bars ?? []) {
      for (const d of b?.directives ?? []) {
        if (d?.directiveId) ids.add(d.directiveId);
      }
    }
  }
  return ids;
}
