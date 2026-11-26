/**
 * directive-run-stats.js — what each directive did IN THIS RUN, to sit beside what it has done historically.
 *
 * ── WHY BOTH HALVES ARE NEEDED (note j) ────────────────────────────────────────────────────────────
 * The directive record answers "how often has this voice been right?" over the stored sample. It cannot
 * answer "was this voice even in the room for these numbers?" — and those are different questions with
 * the same-looking answer. A directive with a 90% hit rate that scored on none of this run's bars
 * explains nothing about this run; a directive that scored on every bar and has never been measured is
 * the more interesting row. Printing them in one table, each labelled with its own population, is the
 * point: "which voice was right?" needs both.
 *
 * ⚠️ THE TWO POPULATIONS ARE NEVER MERGED. This module counts bars; the record counts matured
 * predictions across every strategy and symbol. They are not the same denominator and must not be
 * presented as if they could be added, averaged or compared directly.
 */

/**
 * @param {Array<{detail?:{bars?:Array<{directives?:Array<{directiveId?:string, score?:number|null}>}>}}>} entries
 * @returns {{
 *   directives: Array<{id:string, bars:number, scored:number, mean:number|null, peak:number|null}>,
 *   bars:number,
 *   attributed:number,
 * }}
 *   `bars` is every bar the run produced; `attributed` is the ones carrying at least one directive, so
 *   a payload with no breakdown is VISIBLE as `attributed: 0` rather than reading as "no directive fired".
 */
export function buildRunDirectiveStats(entries) {
  const byId = new Map();
  let bars = 0;
  let attributed = 0;

  for (const e of Array.isArray(entries) ? entries : []) {
    for (const b of e?.detail?.bars ?? []) {
      bars += 1;
      const listed = (b?.directives ?? []).filter((d) => d && d.directiveId);
      if (listed.length) attributed += 1;

      for (const d of listed) {
        const cur = byId.get(d.directiveId) ?? { id: d.directiveId, bars: 0, scored: 0, sum: 0, peak: null };
        cur.bars += 1;
        /**
         * ⚠️ A NULL SCORE IS NOT ZERO. The bar names the directive, so the bar counts — but a score the
         * engine did not record must not be averaged in as 0, which would drag the mean toward nothing
         * and read as "this directive scored low". Same trap as `Number(null) === 0` in the P/L bars.
         */
        if (typeof d.score === 'number' && Number.isFinite(d.score)) {
          cur.scored += 1;
          cur.sum += d.score;
          cur.peak = cur.peak === null ? d.score : Math.max(cur.peak, d.score);
        }
        byId.set(d.directiveId, cur);
      }
    }
  }

  return {
    directives: [...byId.values()].map(({ id, bars: n, scored, sum, peak }) => ({
      id,
      bars: n,
      scored,
      mean: scored ? sum / scored : null,
      peak,
    })),
    bars,
    attributed,
  };
}
