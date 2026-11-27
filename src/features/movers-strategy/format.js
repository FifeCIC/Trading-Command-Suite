/**
 * format.js — this STRATEGY'S display formatters, moved out of the page (#1342).
 *
 * ── WHY THEY MOVED RATHER THAN BEING COPIED ─────────────────────────────────────────────────────
 * The page needed them and the extracted step components need them. Two copies would drift and only
 * one would get the next fix, so there is one file and both import it.
 *
 * ⚠️ THE PERCENTAGE AND MONEY FORMATTERS THAT USED TO LIVE HERE ARE GONE — THEY WERE EXACT COPIES.
 * The comment that justified them claimed `formatPct` "returns an unsigned percentage". It does not:
 * it signs a positive value, exactly as this file did. Measured 2026-11-17, both produced identical
 * strings, so the "do not unify" instruction was protecting a duplication with no reason to exist.
 * `formatPct(n)` and `formatAmount(n)` in `src/core/format-utils.js` own them now, and the NaN guard
 * that lived here ("present but not a number" must render as an em dash) moved into them.
 *
 * ⚠️ `dayLabel` stays because it is genuinely this feature's own: a DATE STRING in UTC, not a
 * timestamp, and a layout (`Mon 10 Nov`) nothing else uses.
 */

/** `2026-11-10` → `Mon 10 Nov`. Formatted in UTC from the string so no local timezone can shift it. */
export function dayLabel(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * progressLabel() — which day of how many is running (2026-11-27).
 *
 * ── WHY THIS IS A FUNCTION AND NOT AN EXPRESSION IN THE JSX ─────────────────────────────────────
 * The page showed `Running Mon 10 Nov… · 00:41` — a day name and a clock, but nothing saying whether
 * the reader was on day one of five or day four of five. With a throttle of 1.5 s per day and five days
 * selected, "is it working?" was a question the reader had to answer by waiting.
 *
 * ⚠️ IT IS OFF-BY-ONE-PRONE, which is the whole reason it is testable here. `progress.done` counts
 * FINISHED days, so while day `i` is running `done` is `i` — the reader is on `done + 1`. When the run
 * has finished `done` is already the total, and adding one would report a sixth day for a five-day
 * queue. `running` is the only thing that distinguishes the two, so it is an explicit argument rather
 * than something inferred from the numbers.
 *
 * ⚠️ NO PROGRESS (`null`) RETURNS `null`, never `0/0` — nothing has run, which is not "everything
 * finished".
 */
export function progressLabel(progress, running) {
  if (!progress || !Array.isArray(progress.queue) || progress.queue.length === 0) return null;
  const total = progress.queue.length;
  const done = Math.max(0, Math.min(Number(progress.done) || 0, total));
  const shown = running ? Math.min(done + 1, total) : done;
  return `${shown}/${total}`;
}

