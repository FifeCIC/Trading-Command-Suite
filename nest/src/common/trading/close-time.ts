/**
 * close-time.ts — is `closedAt` a BROKER close time, or the moment the app NOTICED? (#1045)
 * ===========================================================================================
 *
 * THE DEFECT
 * ----------
 * `finalizeClosedPosition()` writes `closedAt` from the broker's own last exit-deal time **when it
 * finds one**, and falls back to `new Date()` when it does not:
 *
 *     const lastExitTime = exitDeals[exitDeals.length - 1]?.time;
 *     if (lastExitTime) closedAt = new Date(lastExitTime);
 *     …
 *     closedAt: closedAt ?? new Date(),      // ← NOTICE time when no deal history was found
 *
 * So `closedAt - openedAt` is a trade's DURATION for some rows and the app's RECONCILIATION LATENCY
 * for others, with nothing on the row saying which. A consumer cannot tell the two apart, and a
 * plausible duration is exactly the "plausible number, no error" shape this repo keeps re-finding.
 *
 * MEASURED 2026-10-01
 * -------------------
 *   | population                           |   n | inverted | avg openedAt→closedAt |
 *   |--------------------------------------|-----|----------|-----------------------|
 *   | an exit price was captured           | 231 |        0 |             15.7 h    |
 *   | NO exit price (⇒ no deal history)    | 134 |        0 |            587.5 h    |
 *
 * 587 hours is **24 days**. The bots here scalp on 1–15 minute cadences, so a 24-day "holding time"
 * is not a holding time — it is how long the row sat open until a reconciler noticed. No row has an
 * inverted timestamp, so the ordering is sound; only the MEANING of the value is ambiguous.
 *
 * ⚠️ WHY `pnlInvalid = 1` IS NOT THE ANSWER, EVEN THOUGH IT WORKS TODAY
 * -------------------------------------------------------------------
 * Every one of the 134 carries `pnlInvalid = 1`, and every consumer that computes a duration
 * happens to filter on it — which is why **no reported number is currently wrong**. That is a
 * coincidence of two facts joined by accident: the flag means *"the P&L could not be computed"*,
 * and a close time is derived exactly when *"deal history was found"*. They agree today because
 * both hinge on deal history. A future change to either — a flag cleared by a repair, an exit
 * recovered from a last price rather than a deal — breaks the other silently.
 *
 * So the rule is stated once, here, and consumers ask THIS question rather than reusing a flag
 * that means something else.
 *
 * ⚠️ `closedAt` IS NEVER NULLED. It is the "this trade is closed" predicate across the app
 * (`closedAt IS NOT NULL`); making it null would RE-OPEN 134 closed trades. The honest answer is to
 * keep the value and refuse to report a duration derived from it.
 */

/** The facts needed. Structural, so a raw Prisma row can be passed. */
export interface CloseTimeFacts {
  openedAt?: Date | string | null;
  closedAt?: Date | string | null;
  /** An exit price implies the broker gave us something to price the close with. */
  exitPrice?: number | null;
  pnlInvalid?: number | boolean | null;
}

/**
 * Was `closedAt` derived from the broker, or written when the app noticed the position had gone?
 *
 * The evidence is deal history, and the only durable trace of it on the row is that a close price
 * could be resolved. `pnlInvalid = 1` is accepted as a second signal because it is set on exactly
 * the same condition — but it is the WEAKER of the two, so an exit price alone is enough.
 */
export function closeTimeIsBrokerDerived(row: CloseTimeFacts): boolean {
  if (row.closedAt === null || row.closedAt === undefined) return false;
  if (row.exitPrice !== null && row.exitPrice !== undefined) return true;
  return Number(row.pnlInvalid ?? 0) !== 1;
}

/**
 * The trade's duration in hours, or **null when it cannot be known**.
 *
 * ⚠️ `null` is the answer, not `0` and not the raw difference. Returning the number anyway is how a
 * 24-day reconciliation delay enters an average as a holding time; returning `0` would fold a
 * missing measurement into a real one. The caller decides how to display an unknown.
 */
export function tradeLifetimeHours(row: CloseTimeFacts): number | null {
  if (!closeTimeIsBrokerDerived(row)) return null;
  if (!row.openedAt || !row.closedAt) return null;
  const from = new Date(row.openedAt).getTime();
  const to = new Date(row.closedAt).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  // A negative lifetime means the timestamps disagree — report unknown, never a negative duration.
  if (to < from) return null;
  return (to - from) / 3600000;
}

/**
 * Mean lifetime over the rows where it is knowable, plus how many were skipped.
 *
 * `hours` is **null** when nothing was measurable — never `0`, which would read as "instant".
 */
export function meanLifetimeHours(rows: CloseTimeFacts[]): { hours: number | null; measured: number; skipped: number } {
  const vals: number[] = [];
  let skipped = 0;
  for (const r of rows) {
    const h = tradeLifetimeHours(r);
    if (h === null) skipped += 1;
    else vals.push(h);
  }
  if (vals.length === 0) return { hours: null, measured: 0, skipped };
  return { hours: vals.reduce((a, b) => a + b, 0) / vals.length, measured: vals.length, skipped };
}
