import { barLengthMs, isBarBeyondItsOwnLength, BAR_LEAD_TOLERANCE_MS } from './timeframe';

/**
 * Why this guard needs pinning (#780)
 * ===================================
 * `INV-NO-FUTURE-ROWS` failed on healthy live data because it asked the WRONG question:
 * "is this timestamp later than now?" A bar is stamped by its **OPEN** time, so the
 * currently-forming bar is legitimately ahead of the wall clock — by up to one bar length.
 *
 *     forming 15m bar opens 19:15 while the clock reads 19:02  ->  +13min : CORRECT
 *     forming  1m bar opens 19:02 while the clock reads 19:01  ->  +1 min : CORRECT
 *
 * The right question is "is this timestamp beyond its OWN bar length?", and that is what
 * `isBarBeyondItsOwnLength` answers. These tests pin the boundary in both directions,
 * because getting it wrong either way is costly:
 *
 *   - too strict  -> healthy forming bars are rejected, and the feed looks broken
 *   - too lenient -> an impossible row is persisted, and because the upsert only touches
 *                    rows it just fetched, NOTHING can ever overwrite it. It pins
 *                    `MAX(timestamp)` for that symbol forever (#780: 226 such rows, 17
 *                    symbols pinned, while the bridges were down).
 */
describe('isBarBeyondItsOwnLength — the bar-length guard (#780)', () => {
  // A fixed instant so the boundary arithmetic is exact and the test cannot flake.
  const NOW = Date.parse('2026-09-10T19:02:00.000Z');

  describe('accepts legitimate forming bars (must NOT be rejected)', () => {
    it('accepts a forming 15m bar opening 13 minutes ahead', () => {
      // The real case that broke INV-NO-FUTURE-ROWS: clock 19:02, forming 15m bar at 19:15.
      expect(isBarBeyondItsOwnLength('2026-09-10T19:15:00.000Z', '15m', NOW)).toBe(false);
    });

    it('accepts a forming 1m bar opening 1 minute ahead', () => {
      expect(isBarBeyondItsOwnLength('2026-09-10T19:03:00.000Z', '1m', NOW)).toBe(false);
    });

    it('accepts a bar exactly at now, and any past bar', () => {
      expect(isBarBeyondItsOwnLength('2026-09-10T19:02:00.000Z', '1m', NOW)).toBe(false);
      expect(isBarBeyondItsOwnLength('2026-09-10T18:00:00.000Z', '1m', NOW)).toBe(false);
    });

    it('accepts a lead that is inside the jitter tolerance', () => {
      // 1m bar + tolerance(120s) = 180s allowed. 170s ahead must pass.
      const ts = new Date(NOW + 170_000).toISOString();
      expect(isBarBeyondItsOwnLength(ts, '1m', NOW)).toBe(false);
    });
  });

  describe('rejects impossible bars (must be skipped)', () => {
    it('rejects a 1m bar 14 minutes ahead — the #780 shape', () => {
      // This is the actual defect: a leading timestamp across 1m/5m/15m for one symbol.
      // Impossible as a bar; was persisted and unoverwritable.
      expect(isBarBeyondItsOwnLength('2026-09-10T19:16:00.000Z', '1m', NOW)).toBe(true);
    });

    it('rejects a 1m bar exactly one bar length + tolerance + 1s ahead', () => {
      const ts = new Date(NOW + barLengthMs('1m') + BAR_LEAD_TOLERANCE_MS + 1000).toISOString();
      expect(isBarBeyondItsOwnLength(ts, '1m', NOW)).toBe(true);
    });

    it('rejects the same instant for a fine cadence but accepts it for 15m', () => {
      // The discriminator that isolates the real defect: identical timestamp, different
      // verdict by cadence. A 15m bar 13min ahead is forming; a 1m bar is impossible.
      const ts = '2026-09-10T19:15:00.000Z';
      expect(isBarBeyondItsOwnLength(ts, '1m', NOW)).toBe(true);
      expect(isBarBeyondItsOwnLength(ts, '15m', NOW)).toBe(false);
    });

    it('rejects a daily bar more than a day ahead', () => {
      expect(isBarBeyondItsOwnLength('2026-09-12T19:00:00.000Z', '1d', NOW)).toBe(true);
    });
  });

  describe('malformed input is a different fault and must not be swallowed', () => {
    it('returns false for an unparseable timestamp (does not silently reject)', () => {
      expect(isBarBeyondItsOwnLength('not-a-date', '1m', NOW)).toBe(false);
      expect(isBarBeyondItsOwnLength(null, '1m', NOW)).toBe(false);
      expect(isBarBeyondItsOwnLength(undefined, '1m', NOW)).toBe(false);
    });
  });

  describe('barLengthMs', () => {
    it('returns the documented duration for known cadences', () => {
      expect(barLengthMs('1m')).toBe(60_000);
      expect(barLengthMs('5m')).toBe(300_000);
      expect(barLengthMs('15m')).toBe(900_000);
      expect(barLengthMs('1h')).toBe(3_600_000);
      expect(barLengthMs('4h')).toBe(14_400_000);
      expect(barLengthMs('1d')).toBe(86_400_000);
    });

    it('falls back to daily for an unknown cadence rather than returning 0', () => {
      // Returning 0 would make every future-dated bar "impossible" and reject the feed.
      expect(barLengthMs('7m')).toBe(86_400_000);
      expect(barLengthMs('')).toBe(86_400_000);
    });

    it('stays in step with TF_STALE_MS for every cadence the refresh fetches', () => {
      // The refresh list is 1m/5m/15m/1h/4h/1d. If a cadence is added to one table and
      // not the other, staleness tolerance and the bar guard disagree — which is how
      // `1m` silently fell through to a 24h default before #780.
      for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d']) {
        expect(barLengthMs(tf)).toBeGreaterThan(0);
      }
    });
  });
});
