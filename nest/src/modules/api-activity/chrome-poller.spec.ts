/**
 * chrome-poller.spec.ts — not every request deserves an `apiactivitylog` row (#1241).
 *
 * ⚠️ THE MEASURED PROBLEM. On 2026-11-06, ~130,000 of 132,184 rows were the frontend polling for its
 * own display: `/alerts/active` 13,659, `/trading/mt5/candles` 13,980, `/scoring/protocols` 11,009,
 * `/automation/status` 10,721, `/speed/scan` 10,272, `/health` 8,763. 58 MB a day — 22% of the
 * database's total write volume — for observability noise.
 *
 * ⚠️ THE RULE HAS TWO WAYS TO BE WRONG AND BOTH ARE TESTED HERE. Skipping too little saves nothing;
 * skipping too much deletes the rows anyone would actually go looking for.
 */
import { CHROME_POLLERS, shouldRecordActivity } from './api-activity.service';

const rec = (endpoint: string, method = 'GET', statusCode = 200) =>
  shouldRecordActivity({ endpoint, method, statusCode });

describe('shouldRecordActivity — the pollers are skipped', () => {
  it.each(CHROME_POLLERS)('skips %s', (p) => {
    expect(rec(p)).toBe(false);
  });

  it('skips a sub-path of a poller', () => {
    expect(rec('/scoring/protocols/abc')).toBe(false);
  });

  it('ignores a query string — the endpoint key is the path', () => {
    expect(rec('/health?ts=123')).toBe(false);
  });
});

describe('shouldRecordActivity — what must NEVER be skipped', () => {
  // ⚠️ THE EXPENSIVE MISTAKE. `/health` is a chrome poller; a 503 on `/health` is the single most
  // valuable row in the table. A skip rule that does not distinguish them deletes its own evidence.
  it('records a FAILURE on a skipped route', () => {
    expect(rec('/health', 'GET', 503)).toBe(true);
    expect(rec('/alerts/active', 'GET', 500)).toBe(true);
  });

  it('records any non-GET method, whatever the route', () => {
    expect(rec('/health', 'POST', 200)).toBe(true);
    expect(rec('/scoring/protocols', 'DELETE', 200)).toBe(true);
  });

  // ⚠️ NARROW ON PURPOSE — `/trading/mt5/candles` was the single largest poller (13,980 rows) and it
  // is DELIBERATELY NOT skipped: it is the call that proves bars are still being fetched, so its
  // absence would hide a provider stall behind an empty table.
  it('does NOT skip the candles poller — it is the only evidence bars are still flowing', () => {
    expect(rec('/trading/mt5/candles')).toBe(true);
    expect(CHROME_POLLERS).not.toContain('/trading/mt5/candles');
  });

  it('records an unrelated endpoint', () => {
    expect(rec('/portfolio/summary')).toBe(true);
  });

  // A prefix match must not leak: `/health` must not swallow `/health-dashboard`, which is a real
  // aggregate query worth measuring.
  it('a poller does not swallow a longer sibling route', () => {
    expect(rec('/health-dashboard')).toBe(true);
  });
});
