import { isBarFutureStamped, isBarBeyondItsOwnLength, BAR_LEAD_TOLERANCE_MS } from './timeframe';

/**
 * #832 — a bar's OPEN time cannot be in the future.
 *
 * ⚠️ WHY THIS SPEC EXISTS SEPARATELY FROM `bar-length-guard.spec.ts`
 *
 * That file pins the behaviour of `isBarBeyondItsOwnLength`, whose bound is one full
 * bar length plus tolerance. Its own test header states the gap:
 *
 *   "the raw 20:45 bar IS future-dated, and `isBarBeyondItsOwnLength` cannot see it"
 *
 * `isBarBeyondItsOwnLength` is now deprecated and kept only so that historical
 * assertion remains expressible. THIS file pins the rule that actually protects the
 * feed, and it is deliberately written around the **measured production case** rather
 * than a synthetic one.
 *
 * ⚠️ THE REAL CASE (measured 2026-09-15, XAUUSD, provider `mt5`)
 *
 *   20:00  open=4295.53  close=4302.50   <- stamped AHEAD of now
 *   16:00  open=4295.53  close=4300.35   <- IDENTICAL open
 *   12:00  open=4290.22  close=4295.55
 *
 * `open[20:00] === open[16:00]` proves both rows describe the SAME 16:00–20:00 bucket,
 * and `open[16:00] ≈ close[12:00]` proves the series is open-stamped and continuous.
 * So the 20:00 row is a duplicate of the in-progress bucket stamped at its CLOSE.
 *
 * It was persisted because it led `now` by only ~21–52 minutes — comfortably inside
 * the old one-bar-length bound. It then pinned `MAX(timestamp)` ahead of now, so
 * `computeMarketStatus()` failed closed with "data clock skew" on every pass and
 * `Gold Position 4H` could not trade at all.
 */
describe('isBarFutureStamped — open-stamped bars cannot lead now (#832)', () => {
  // 19:08 UTC — the moment the production skew was measured at ~52 minutes.
  const NOW = Date.parse('2026-09-15T19:08:00.000Z');

  describe('the measured production case', () => {
    it('rejects the 20:00 4h bar that blocked Gold Position 4H', () => {
      // The exact timestamp that was persisted and tripped the clock-skew guard.
      expect(isBarFutureStamped('2026-09-15T20:00:00.000Z', NOW)).toBe(true);
    });

    it('the deprecacted guard explains why this got through: it cannot see a 52-min lead', () => {
      // Same timestamp, old rule — returns false, which is the whole defect.
      expect(isBarBeyondItsOwnLength('2026-09-15T20:00:00.000Z', '4h', NOW)).toBe(false);
      // ...and the new rule disagrees, correctly.
      expect(isBarFutureStamped('2026-09-15T20:00:00.000Z', NOW)).toBe(true);
    });

    it('accepts the genuine in-progress bucket at 16:00', () => {
      // The real bar for 16:00–20:00. Its OPEN has happened, so it is valid.
      expect(isBarFutureStamped('2026-09-15T16:00:00.000Z', NOW)).toBe(false);
    });

    it('accepts every other timeframe\'s newest bar as measured', () => {
      // 1m 19:06, 5m 19:05, 1h 19:00 — all genuinely in the past.
      expect(isBarFutureStamped('2026-09-15T19:06:00.000Z', NOW)).toBe(false);
      expect(isBarFutureStamped('2026-09-15T19:05:00.000Z', NOW)).toBe(false);
      expect(isBarFutureStamped('2026-09-15T19:00:00.000Z', NOW)).toBe(false);
    });
  });

  describe('the jitter tolerance is the ONLY permitted lead', () => {
    it('allows a lead inside the jitter tolerance', () => {
      const inside = new Date(NOW + BAR_LEAD_TOLERANCE_MS - 1000).toISOString();
      expect(isBarFutureStamped(inside, NOW)).toBe(false);
    });

    it('rejects a lead beyond the jitter tolerance, whatever the cadence', () => {
      const beyond = new Date(NOW + BAR_LEAD_TOLERANCE_MS + 1000).toISOString();
      expect(isBarFutureStamped(beyond, NOW)).toBe(true);
    });

    it('a 1-minute lead is still inside the jitter tolerance', () => {
      // The tolerance is 2 minutes, so 1 minute of lead is legitimate clock jitter.
      const oneMinuteAhead = new Date(NOW + 60_000).toISOString();
      expect(isBarFutureStamped(oneMinuteAhead, NOW)).toBe(false);
      // ⚠️ But the old bound allowed a WHOLE BAR LENGTH of lead — 4h + 2min for a 4h
      // bar. The measured production skew (21–52 min) sat between the two rules,
      // which is exactly why the old guard could not see it.
      const measuredSkew = new Date(NOW + 52 * 60_000).toISOString();
      expect(isBarFutureStamped(measuredSkew, NOW)).toBe(true);
      expect(isBarBeyondItsOwnLength(measuredSkew, '4h', NOW)).toBe(false);
    });
  });

  describe('no false positives on legitimate data', () => {
    it('accepts a bar stamped exactly now (synthetic placeholders are stamped `now`)', () => {
      expect(isBarFutureStamped(new Date(NOW).toISOString(), NOW)).toBe(false);
    });

    it('accepts an old bar', () => {
      expect(isBarFutureStamped('2026-01-01T00:00:00.000Z', NOW)).toBe(false);
    });

    it('returns false for malformed input — a different fault, not this guard\'s to swallow', () => {
      // A malformed timestamp must NOT be silently treated as a future stamp;
      // the caller rejects it separately (#783).
      expect(isBarFutureStamped('not-a-date', NOW)).toBe(false);
      expect(isBarFutureStamped(null, NOW)).toBe(false);
      expect(isBarFutureStamped(undefined, NOW)).toBe(false);
    });
  });

  describe('the escape hatch is explicit', () => {
    it('admits a proven close-stamped source only when asked', () => {
      // Must be BEYOND the jitter tolerance, or the open-stamped branch also allows it.
      const ahead = new Date(NOW + BAR_LEAD_TOLERANCE_MS + 60_000).toISOString();
      expect(isBarFutureStamped(ahead, NOW, true)).toBe(true);
      expect(isBarFutureStamped(ahead, NOW, false)).toBe(false);
    });
  });
});
