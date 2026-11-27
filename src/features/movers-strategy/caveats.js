/**
 * caveats.js — turn a run's caveats into the rows step 2 prints.
 *
 * ── WHY THIS IS A MODULE AND NOT AN INLINE `useMemo` ─────────────────────────────────────────────
 * The rules below are the whole reason the table is readable, and they were previously a comment: five
 * days produce five variants of "measured on <date>", so a row per sentence rebuilds the wall the owner
 * asked to have removed. Grouping is a decision, and a decision in a `useMemo` cannot be tested.
 *
 * ⚠️ THE SERVER SENDS `caveatRows` (structured) AND `caveats` (the same sentences as strings). This reads
 * the STRUCTURED form only — never parses prose, because a table assembled by string-matching breaks the
 * first time someone rewords a sentence.
 */

/**
 * @param {Array<{ caveatRows?: Array<{code:string,label:string,qualifies:string,gist?:string,text:string}> }>} runs
 * @param {Iterable<string>} [gateSentences] statements the page already renders elsewhere, so one fact
 *   never appears twice.
 * @returns {Array<{code:string,label:string,qualifies:string,gist:string|null,texts:string[],days:number}>}
 */
export function groupCaveats(runs, gateSentences = []) {
  const skip = new Set([...gateSentences].filter(Boolean));
  const byCode = new Map();

  for (const run of runs ?? []) {
    for (const row of run?.caveatRows ?? []) {
      if (!row || skip.has(row.text)) continue;
      const entry = byCode.get(row.code) ?? {
        code: row.code,
        label: row.label,
        qualifies: row.qualifies,
        /**
         * ⚠️ THE SHORT FORM IS TAKEN FROM THE FIRST ROW THAT CARRIES ONE, and a row without one keeps
         * `null` — never a truncated `text`. A truncation reads as a cut-off sentence ("The candidate
         * list (10 symbols) was built from"), which is worse than no gist: the cell then shows the full
         * sentence instead, so an older payload degrades to the previous behaviour rather than to a
         * fragment.
         */
        gist: typeof row.gist === 'string' && row.gist.trim() ? row.gist.trim() : null,
        texts: [],
        days: 0,
      };
      if (!entry.gist && typeof row.gist === 'string' && row.gist.trim()) entry.gist = row.gist.trim();
      if (!entry.texts.includes(row.text)) entry.texts.push(row.text);
      entry.days += 1;
      byCode.set(row.code, entry);
    }
  }

  return [...byCode.values()];
}

/**
 * The one-line form of a grouped row.
 *
 * ⚠️ `e.g.` IS NOT DECORATION. When days disagree — and they do, because every sentence carries its own
 * date and counts — printing the first as if it were the whole would state one day's figure beside a
 * five-day total. The prefix says "this is an example"; `days` says how many it stands for.
 */
export function caveatDetail(row) {
  if (!row?.texts?.length) return '';
  if (row.texts.length === 1) return row.texts[0];
  return `e.g. ${row.texts[0]}`;
}
