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
