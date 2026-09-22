/**
 * position-freshness.ts — the ONE definition of a broker-maintained ("live") position (#854, #778).
 * =================================================================================================
 *
 * ⚠️ WHY THIS EXISTS. The `position` table holds two populations with sharply different writers:
 *
 *   - rows maintained by `PositionSyncService` on every loop tick — `lastQuotedAt` ages in
 *     MINUTES (measured 2026-09-22: MT5 rows 07:45 → 10:41 across a morning);
 *   - rows created once by the Trading 212 portfolio IMPORT and never touched again — frozen at
 *     their import time (measured: 24 rows all quoted 2026-07-31 01:25, ~8 weeks).
 *
 * They LOOK identical (quantity, avg price, P&L) and nothing errors when a reader treats the
 * frozen ones as current. That produced two filed defects: #854 (the Symbols Browser showings 24
 * imported stocks as live holdings) and #778 (cached rows counted in exposure/diversification,
 * with the portfolio reading as 99.98% stale-import value).
 *
 * THE RULE: a row is a LIVE position when a broker sync refreshed its quote inside the window.
 * The 7-day window sits between the two populations BY CONSTRUCTION: sync-refreshed rows can
 * never fall outside it (even through a long weekend plus machine downtime); frozen import rows
 * can never fall inside it. If syncs genuinely stop for a week, the rows ARE stale and saying so
 * is the honest answer.
 *
 * An undateable `lastQuotedAt` is NOT live (fail-closed): we cannot date it, so we cannot claim
 * a broker maintains it.
 *
 * ⚠️ Do not duplicate this logic in readers. Import it — a second copy drifts, and only one copy
 * gets the next fix (the same reason `signal-freshness.ts` exists for queue entries).
 */
export const POSITION_LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** True when a broker sync refreshed this row's quote inside POSITION_LIVE_WINDOW_MS. */
export function isLivePosition(
  lastQuotedAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (lastQuotedAt == null) return false;
  const t = lastQuotedAt instanceof Date ? lastQuotedAt.getTime() : new Date(lastQuotedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= now - POSITION_LIVE_WINDOW_MS;
}
