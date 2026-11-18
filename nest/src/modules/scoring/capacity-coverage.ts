/**
 * capacity-coverage.ts — the window that was READ, not the window that was ASKED FOR (#1245).
 * ================================================================================================
 *
 * ⚠️ WHY THIS IS ITS OWN MODULE. `DataRetentionService.throttleScores()` keeps only the most recent
 * `keepPerGroup` rows per `(symbolId, strategyId)` in `score`, and at a ~2-minute scoring tick a hot
 * pair reaches **100 rows in about 4.2 HOURS**. Measured 2026-11-18 on the live database, the same
 * **9,048 rows** came back for `?days=1`, `?days=7` and everything between:
 *
 *   window      rows read
 *   3 hours         5,496
 *   4.2 hours       9,048   ← everything that exists for the active protocols
 *   12 hours        9,048
 *   1 day           9,048
 *   7 days          9,048   ← the default `reachable-capacity` is called with
 *   90 days        17,100   ← grows ONLY because 47 dormant protocols contribute stale 2026-11-01
 *                              rows; it is not more depth for the live ones
 *
 * So an answer derived from ~4 hours was presented as a 7-day measurement with nothing saying so —
 * the "plausible output, no error" shape this repo keeps re-finding. This module exists so the
 * answer can say what it is.
 *
 * ⚠️ IT IS REPORTING ONLY. `finaliseCoverage()` changes no figure in the response; it adds the
 * evidence a reader needs to know which span the figures describe.
 *
 * ⚠️ AND IT LIVES HERE RATHER THAN IN THE CONTROLLER for a measured reason: adding it inline took
 * `protocol-gating.controller.ts` from 1,284 to 1,529 lines and tripped the code-health ratchet at
 * 1,500. A controller that large is #1229's subject; growing it to hold a reporting helper would
 * have been the wrong trade even after re-freezing the baseline.
 */

/** One decimal place, or the UI reads 46.50000000000001. Also used by the gating controller. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface CapacityCoverage {
  requestedDays: number;
  requestedFrom: string;
  /** Oldest and newest `score` row actually read. `null` when the window contained nothing. */
  from: string | null;
  to: string | null;
  hoursCovered: number;
  rowsScanned: number;
  /** True when the data does not reach back to `requestedFrom` — a partial window. */
  truncated: boolean;
  /** How much of the requested window the data covers, as a percentage. */
  coveredPct: number;
}

export function newCoverage(requestedDays: number, requestedFrom: Date, rowsScanned: number): CapacityCoverage {
  return {
    requestedDays,
    requestedFrom: requestedFrom.toISOString(),
    from: null,
    to: null,
    hoursCovered: 0,
    rowsScanned,
    truncated: false,
    coveredPct: 0,
  };
}

/**
 * ⚠️ THE ONE-MINUTE SLACK IS NOT FUDGE. The oldest row cannot be newer than the request boundary
 * unless data is missing — but it is routinely a few seconds newer, because the boundary is
 * `now - days` and the last scoring tick happened before `now`. Without slack, every complete window
 * would report `truncated: true` and the flag would be worthless within a day. Both directions are
 * pinned in `capacity-coverage.spec.ts` — too eager and too lax are opposite failures.
 */
export function finaliseCoverage(c: CapacityCoverage): CapacityCoverage {
  if (c.from !== null && c.to !== null) {
    c.hoursCovered = round1((Date.parse(c.to) - Date.parse(c.from)) / 3_600_000);
  }
  const SLACK_MS = 60_000;
  c.truncated = c.from === null || Date.parse(c.from) > Date.parse(c.requestedFrom) + SLACK_MS;
  const requestedHours = c.requestedDays * 24;
  c.coveredPct = requestedHours > 0 ? round1((100 * c.hoursCovered) / requestedHours) : 0;
  return c;
}
