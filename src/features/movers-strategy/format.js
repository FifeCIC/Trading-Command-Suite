/**
 * format.js — this STRATEGY'S display formatters, moved out of the page (#1342).
 *
 * ── WHY THEY MOVED RATHER THAN BEING COPIED ─────────────────────────────────────────────────────
 * The page needed them and the extracted step components need them. Two copies would drift and only
 * one would get the next fix, so there is one file and both import it.
 *
 * ⚠️ THESE ARE NOT `src/core/format-utils.js`. That module is the app-wide convention
 * (`formatCurrency` prefixes a currency symbol, `formatPct` returns an unsigned percentage), and this
 * page's figures are read beside each other in a table where a `$` on every cell is noise and the SIGN
 * of a percentage is the point. Keeping them separate is deliberate; do not "unify" them without
 * checking how the tables read.
 */

/** A signed percentage for a move: `+23.4%`, `−2.1%` (typographic minus), `—` when there is none. */
export const fmtPct = (n) => (
  n == null || Number.isNaN(Number(n))
    ? '—'
    : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`
);

/** Money without a currency symbol — the account currency is the same across a table's rows. */
export const fmtMoney = (n) => (
  n == null || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

/** `2026-11-10` → `Mon 10 Nov`. Formatted in UTC from the string so no local timezone can shift it. */
export function dayLabel(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
