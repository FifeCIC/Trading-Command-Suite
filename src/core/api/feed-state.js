/**
 * feedState — "is this an ANSWER, or just the absence of one?" for a react-query feed.
 * =====================================================================================
 * ⚠️ WHY THIS EXISTS (#782 / INV-NO-EMPTY-SWALLOW). `isError` alone is not a safe test for
 * "the request failed", and the gap was MEASURED, not assumed:
 *
 *   2026-11-06, a dashboard tile pointed at a URL that 404s. After 12 seconds react-query reported
 *   `status: 'pending'`, `isError: false`, `failureCount: 1`, `isFetching: false`.
 *
 * That is the RETRY WAIT. The request has already failed; the library is between attempts. During
 * that window `data` is `undefined` and `isError` is still `false`, so a component that tests only
 * `isError` falls through to its "empty" branch — and printed **"Open Positions 0"** and
 * **"nothing at risk"** for the whole retry window on a book it had never read.
 *
 * The three states a reader must be able to tell apart, and the only honest mapping:
 *
 *   'loading'  — a request is in flight and nothing has arrived yet   → skeleton
 *   'ready'    — data arrived (possibly `[]`, which IS an answer)     → render it, empty or not
 *   'error'    — the request failed for good                          → name it, offer retry
 *   'unknown'  — pending, not fetching, no data: a retry backoff or a paused query
 *                                                                    → name it, do NOT render zero
 *
 * `[]` is information. `undefined` is the absence of information. They must never render the same.
 *
 * @param {{ isError?: boolean, data?: unknown, isPending?: boolean, isFetching?: boolean }} query
 * @returns {'loading'|'ready'|'error'|'unknown'}
 */
export function feedState(query) {
  if (!query || typeof query !== 'object') return 'unknown';
  if (query.isError) return 'error';
  if (query.data !== undefined) return 'ready';
  if (query.isPending && query.isFetching) return 'loading';
  return 'unknown';
}

/** True when the feed has produced no answer — failed, retrying, or paused. */
export function feedUnavailable(query) {
  const state = feedState(query);
  return state === 'error' || state === 'unknown';
}
