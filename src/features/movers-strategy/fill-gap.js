/**
 * fill-gap.js — the stop-fill assumption, aggregated across the days that were run.
 *
 * ── WHAT IS BEING SUMMARISED ─────────────────────────────────────────────────────────────────────
 * The engine books every stop exit AT THE LEVEL (`position-bar.ts` returns `price: state.stop`
 * unconditionally). A broker fills at whatever the market offers when the stop triggers. `fillGap`
 * counts the exits whose own bar had already traded PAST that level, and by how much
 * (`stop-fill-gap.ts`, register row 252).
 *
 * ⚠️ IT IS THE SIZE OF AN ASSUMPTION, NOT A CHARGE AGAINST THE P&L. OHLC cannot order the path inside
 * a bar, so a bar beyond the stop may have traded smoothly through it. Nothing is added to any total.
 *
 * ── ⚠️ TWO RULES, AND BOTH ARE EASY TO GET WRONG ────────────────────────────────────────────────
 *
 * 1. **`measured: 0` MEANS "NOT RECORDED", NOT "NO GAP".** A run whose trades carry no exit-bar fields
 *    lands there. Aggregating it as a clean zero would turn "cannot judge" into "fine" — the failure
 *    mode this repo designs against — so unmeasured days are COUNTED and reported separately.
 *
 * 2. **COUNTS SUM; PERCENTILES DO NOT.** `measured` and `beyond` are exit counts and add across days.
 *    A median is a property of one run's own population; the median of five medians is a number about
 *    nothing. So the percentiles are reported as the RANGE across the days that could be measured, and
 *    `worst` is the largest observed — both stated as ranges/maxima rather than as a headline figure.
 */

/**
 * @param {Array<{ fillGap?: { measured?: number, beyond?: number, medianPct?: number|null, p90Pct?: number|null, worstPct?: number|null } }>} runs
 * @returns {{
 *   runs: number, measuredRuns: number, unmeasuredRuns: number,
 *   measured: number, beyond: number,
 *   median: {min:number,max:number}|null, p90: {min:number,max:number}|null, worst: number|null
 * }}
 */
export function summariseFillGaps(runs) {
  const gaps = (runs ?? []).map((r) => r?.fillGap).filter(Boolean);
  const withData = gaps.filter((g) => Number(g.measured) > 0);

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const rangeOf = (key) => {
    const vals = withData.map((g) => g[key]).filter(finite);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  };
  const worstVals = withData.map((g) => g.worstPct).filter(finite);

  /**
   * ⚠️ `stopExits` AND `unrecorded` ARE CARRIED THROUGH, not merely summed, because they separate the
   * two possible meanings of `measured: 0`: a day with no stop exit at all, and a day whose stop exits
   * were recorded without the bar's adverse extreme.
   *
   * 🛑 The second state was NOT observed when this was written (2026-11-26). `movers-winners-2026-11-19`
   * looked like one — 4 SL exits with blank extremes — but those were trades the SELECTION REFUSED, and
   * the admitted population held no stop exit at all (`stopExits: 0`). Do not cite that day.
   */
  return {
    runs: gaps.length,
    measuredRuns: withData.length,
    unmeasuredRuns: gaps.length - withData.length,
    measured: gaps.reduce((a, g) => a + Number(g.measured ?? 0), 0),
    beyond: gaps.reduce((a, g) => a + Number(g.beyond ?? 0), 0),
    stopExits: gaps.reduce((a, g) => a + Number(g.stopExits ?? 0), 0),
    unrecorded: gaps.reduce((a, g) => a + Number(g.unrecorded ?? 0), 0),
    median: rangeOf('medianPct'),
    p90: rangeOf('p90Pct'),
    worst: worstVals.length ? Math.max(...worstVals) : null,
  };
}

/** `2.33%`, or `2.33–2.98%` when the days disagree. Never a single figure standing for several. */
export function formatRange(range) {
  if (!range) return null;
  if (range.min === range.max) return `${range.min}%`;
  return `${range.min}–${range.max}%`;
}

/**
 * fillGapChips() — the stop-fill facts as QUALIFIER CHIPS instead of four paragraphs.
 *
 * ── WHY THE SEVERITY IS DERIVED FROM THE STOP DISTANCE, NOT CHOSEN ──────────────────────────────
 * Owner, 2026-11-26, on the paragraph this replaces: *"the numbers don't stand out, not that I would
 * even understand the point of them."* A chip is believed faster than prose, so its colour has to be a
 * fact. The only defensible comparison is the overshoot against **the bot's own stop distance**: a
 * 25.5% overshoot on a 20% stop means a fill can exceed the entire intended risk, which is `risk`; half
 * the stop is `warn`; below that the assumption is `info`. With no stop distance the materiality cannot
 * be judged, and the chip says `info` rather than inventing a severity.
 *
 * ⚠️ `muted` IS RESERVED FOR NOT MEASURED and never borrows `ok`. "Cannot judge" and "fine" must not
 * look alike — the repo's most repeated defect.
 *
 * @param {ReturnType<typeof summariseFillGaps>} view
 * @param {{ stopPct?: number|null }} [options] the bot's stop distance, in percent
 */
export function fillGapChips(view, options = {}) {
  const stopPct = Number(options.stopPct);
  const hasStop = Number.isFinite(stopPct) && stopPct > 0;
  const chips = [];

  if (!view || view.runs === 0) return chips;

  if (view.measured > 0) {
    const worst = view.worst;
    const ratio = hasStop && Number.isFinite(worst) ? worst / stopPct : null;
    const tone = ratio == null ? 'info' : ratio >= 1 ? 'risk' : ratio >= 0.5 ? 'warn' : 'info';

    chips.push({
      code: 'stops',
      tone,
      label: 'Stops',
      value: hasStop && Number.isFinite(worst)
        ? `worst ${worst}% · stop ${stopPct}%`
        : Number.isFinite(worst) ? `worst ${worst}% past` : 'measured',
      detail:
        `${view.beyond} of ${view.measured} stop exit(s) had a bar extreme beyond the stop level ` +
        `(median ${formatRange(view.median) ?? '—'}, p90 ${formatRange(view.p90) ?? '—'}).`,
      meaning: hasStop && ratio != null
        ? `The engine books every stop at the level; a broker fills at the market. The worst fill here ` +
          `is ${ratio.toFixed(1)}× your stop distance, so the P&L above is optimistic.`
        : 'The engine books every stop at the level; a broker fills at the market. No stop distance was ' +
          'found on this run, so how material that is cannot be judged here.',
    });
  }

  if (view.unrecorded > 0) {
    chips.push({
      code: 'unrecorded',
      tone: 'muted',
      label: 'Not measured',
      value: `${view.unrecorded} of ${view.stopExits} exits`,
      detail:
        `${view.unrecorded} stop exit(s) carry no exit-bar extreme, so they could not be read at all.`,
      meaning: 'That is a gap in what was recorded, not an absence of stops — and not a zero gap.',
    });
  /**
   * ⚠️ COVERAGE ONLY MAKES SENSE WHEN SOMETHING WAS MEASURED. "3 of 5 days had no stop exit" beside
   * "these runs contain no stop exit at all" says the same thing twice — the test caught the duplicate.
   */
  } else if (view.measured > 0 && view.unmeasuredRuns > 0) {
    chips.push({
      code: 'coverage',
      tone: 'info',
      label: 'Coverage',
      value: `${view.unmeasuredRuns} of ${view.runs} days had no stop exit`,
      detail: 'Those days contained no SL/TRAIL exit in the admitted population, so the assumption could not be tested there.',
      meaning: 'An absence of stops, not a gap in recording — those days say nothing about slippage either way.',
    });
  }

  if (view.measured === 0 && view.stopExits === 0 && view.unrecorded === 0) {
    chips.push({
      code: 'none',
      tone: 'muted',
      label: 'Not measured',
      value: null,
      detail: 'These runs contain no stop exit at all, so the fill assumption has nothing to describe.',
      meaning: 'An absence of stops — not a zero gap.',
    });
  }

  return chips;
}
