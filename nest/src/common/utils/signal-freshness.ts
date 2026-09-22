/**
 * signal-freshness.ts — how old a queued signal may be before it stops being a signal (#882).
 * ============================================================================================
 *
 * THE DEFECT THIS BOUNDS. `strategy_signal_queue` entries live until they are consumed OR
 * voided by a re-score of their pair — and the void pass only sees pairs scored THIS run
 * (`SignalQueueService.syncQueues`). When scoring stops for a pair (deactivated protocol,
 * symbol removed from scope, dropped session), nothing ever voids its entry: it is IMMORTAL.
 * Measured 2026-09-21 (#882): a 120-hour-old entry executed; a 73.8h entry sat pending against
 * zero scoring in 48h; an order was placed on a 20.6-hour-old score.
 *
 * THE ONE RULE. A pending entry whose LAST CONFIRMATION (`updatedAt`) is older than the bound
 * is expired — it is no longer being observed, so executing it acts on a signal nobody has
 * re-asserted. Notice the field: `updatedAt`, not `createdAt`.
 *
 *   - `createdAt` = first insert. It NEVER moves (`upsertEntry`'s ON DUPLICATE KEY leaves it).
 *   - `updatedAt` = last confirmation. The upsert refreshes it on every re-signal.
 *
 * So a long-waiting but live signal (a session bot whose queue entry is re-confirmed every
 * scoring run) has a FRESH `updatedAt` and must never expire — that waiting is intended.
 * Only an entry nobody is re-confirming goes stale. ⚠️ An earlier pass on #882 ordered by
 * `createdAt` and overstated staleness for 5 of 7 rows for exactly this reason.
 *
 * WHY 360 MINUTES IS THE DEFAULT.
 *   - xau-speed-* bots execute in under 11 minutes — this bound is 30x their whole lifecycle.
 *   - forex-session-v1 entries that were LEGITIMATELY waiting were being re-confirmed every
 *     ~2 minutes (scoring cadence) — they have fresh `updatedAt` and never approach the bound.
 *   - the entries that actually caused harm were 20.6h–120h without confirmation.
 *   - 6h sits an order of magnitude below the harm cases and two orders above the refresh
 *     cadence, so a gap in scoring must be minutes-to-hours long before this fires.
 *
 * OVERRIDE: `SIGNAL_MAX_AGE_MINUTES` (env). This is the ONE number shared by the queue sweep
 * (`SignalQueueService`) and the consumer gate (`AutomationLoopService.processSignalQueues`) —
 * if they disagreed, an entry could survive one and die at the other. Import this, do not
 * redeclare a literal.
 *
 * EXPIRY IS REVERSIBLE, DELIBERATELY. Expiry writes `status='expired'` (archive, audit kept);
 * a later re-signal resurrects the row to `pending` through the existing upsert. Nothing is
 * deleted, so nothing is unrecoverable.
 */
export const SIGNAL_MAX_AGE_DEFAULT_MINUTES = 360;

/** The bound in minutes — env-overridable, validated, one authority. */
export function getMaxSignalAgeMinutes(): number {
  const raw = process.env.SIGNAL_MAX_AGE_MINUTES;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : SIGNAL_MAX_AGE_DEFAULT_MINUTES;
}

/**
 * Minutes since the signal's last confirmation.
 *
 * ⚠️ Unparseable date → Infinity, NOT 0: we cannot claim a signal is fresh when we cannot
 * date it, and this number gate decides whether to spend money. Fail-closed (refuse), never
 * fail-open (execute). With `updatedAt` NOT NULL in the schema this is unreachable in
 * practice; it exists so the unreachable case cannot become the dangerous one.
 */
export function signalAgeMinutes(updatedAt: Date | string | null | undefined, now = Date.now()): number {
  if (updatedAt == null) return Number.POSITIVE_INFINITY;
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((now - t) / 60000));
}
