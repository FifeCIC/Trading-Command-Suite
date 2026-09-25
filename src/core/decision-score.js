/**
 * decision-score.js — ONE answer to "what score did this decision carry, and in what unit?" (#909).
 * =================================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `decision_log.composite` held TWO different quantities under one name: the raw additive protocol
 * score (envelope-ladder and A/B writers — e.g. 178) and the percentage of configured capacity
 * (queue path — e.g. 7). Any table, colour threshold or average that read the column mixed them.
 * The database now carries `compositeRaw` and `compositePct` as separate columns, and pre-split
 * rows keep their value in `composite` with the unit unrecorded.
 *
 * The rule this helper enforces for every surface: **a number is never rendered without its unit.**
 *
 *   compositePct   → `7.0%`      (percentage of configured capacity — what minComposite gates)
 *   compositeRaw   → `178 pts`  (additive protocol score — never compare to a percentage bar)
 *   composite      → `165?`      (historical row: the unit was never recorded — do not compute)
 *   none of them   → ''          (absence is absence, not 0)
 *
 * The legacy value renders with a `?` and a title rather than being hidden or guessed: a reader who
 * needs precision can see that this row predates the split, and a reader who just wants the number
 * still gets it — labelled as uncertain instead of silently wrong.
 */

/** Coerce to a finite number, or null. `'7'` is 7; `''`, `null`, `NaN` and `Infinity` are null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object|null|undefined} row — a decision row from any surface: `decision_log` (raw/pct/
 *   legacy), the in-memory `recentDecisions` (raw/pct only), or `/api/automation/events`.
 * @returns {{ text: string, kind: 'pct'|'raw'|'legacy'|'none', title: string|null, value: number|null }}
 */
export function decisionScore(row) {
  if (!row) return { text: '', kind: 'none', title: null, value: null };

  const pct = num(row.compositePct);
  if (pct !== null) {
    return {
      text: `${pct.toFixed(1)}%`,
      kind: 'pct',
      title: 'Percentage of the protocol’s configured capacity — the unit minComposite gates use.',
      value: pct,
    };
  }

  const raw = num(row.compositeRaw);
  if (raw !== null) {
    return {
      text: `${Math.round(raw)} pts`,
      kind: 'raw',
      // §9.14.1 — `maxScore` is the scoring model's field name; the free edition does not carry the
      // method's vocabulary, so it reads the concept in plain words instead of naming the field.
      // Conditional rather than reworded, so the full edition keeps its own term exactly.
      title:
        import.meta.env.VITE_EDITION === 'free'
          ? 'Raw additive protocol score (sum of the directive maxima) — not a percentage.'
          : 'Raw additive protocol score (directive maxScore sum) — not a percentage.',
      value: raw,
    };
  }

  // Historical rows only: written before #909 split the column, so the unit is not recoverable.
  const legacy = num(row.compositeLegacy ?? row.composite);
  if (legacy !== null) {
    return {
      text: `${Math.round(legacy)}?`,
      kind: 'legacy',
      title:
        'Historical row — recorded before the score columns were split, so its unit is unknown. Do not average or threshold this value.',
      value: legacy,
    };
  }

  return { text: '', kind: 'none', title: null, value: null };
}
