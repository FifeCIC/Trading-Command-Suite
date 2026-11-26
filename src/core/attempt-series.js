/**
 * attempt-series.js — the stored attempts of ONE test, as a series a sparkline can draw.
 *
 * ── WHY THIS IS NOT AN INLINE `map()` IN THE PANEL ───────────────────────────────────────────────
 * Three decisions here change what the reader concludes, and each has been wrong in this repo before:
 *
 * 1. **ORDER.** The history endpoint returns NEWEST FIRST. Plotting that as-is draws time backwards,
 *    so "improving" renders as "decaying". Reversed here, once.
 * 2. **COMPARABILITY.** A run stored under different execution semantics measured different maths.
 *    Joining them into one line claims a continuity that does not exist, so they are EXCLUDED and
 *    COUNTED — an exclusion nobody can see is indistinguishable from data that was never there.
 * 3. **DISTINCT VALUES.** Re-running one day with unchanged settings produces identical P/L, and a
 *    smooth line of five identical points reads as "stable progress" when it is the same answer
 *    repeated. The distinct count is carried so a surface can say so.
 *
 * ⚠️ A MISSING `totals.netPnl` IS NOT ZERO. A row without it is dropped from the line (a fabricated
 * zero would sit on the axis and look like a break-even attempt) and counted in `skipped`.
 */

/**
 * @param {Array<object>|null|undefined} rows newest-first rows from `GET /api/backtest/selection-history`
 * @param {number} semanticsVersion the run's own version; rows from another are not plotted
 * @returns {{
 *   points: Array<{ id: string, at: string|null, netPnl: number }>,
 *   values: number[],
 *   excludedSemantics: number,
 *   skipped: number,
 *   distinct: number
 * }}
 */
export function buildAttemptSeries(rows, semanticsVersion) {
  const list = Array.isArray(rows) ? rows : [];
  const sameSemantics = list.filter((r) => r && (semanticsVersion == null || r.semanticsVersion === semanticsVersion));
  const excludedSemantics = list.length - sameSemantics.length;

  const points = [];
  let skipped = 0;
  // Oldest → newest: the endpoint is newest-first, and a backward time axis inverts the verdict.
  for (const row of [...sameSemantics].reverse()) {
    const netPnl = Number(row?.totals?.netPnl);
    if (!Number.isFinite(netPnl)) {
      skipped += 1;
      continue;
    }
    points.push({ id: row.id ?? '', at: row.createdAt ?? null, netPnl });
  }

  return {
    points,
    values: points.map((p) => p.netPnl),
    excludedSemantics,
    skipped,
    distinct: new Set(points.map((p) => p.netPnl.toFixed(2))).size,
  };
}
