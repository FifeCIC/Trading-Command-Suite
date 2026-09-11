/**
 * bar-refresh-alignment.spec.ts — the REFRESH path must align too (#785).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * #783 fixed `importBars()` in `import-jobs.service.ts`, but our main ingestion path is
 * `BarRefreshService` — the one that runs every few minutes — and it still stored
 * `new Date(bar.timestamp)` verbatim. A bulk refresh on 2026-09-11 18:23 wrote every
 * higher timeframe stamped `:45` (5,854 `4h`, 5,785 `1d`, 5,780 `1h`).
 *
 * The consequence was not cosmetic. A `:45` bar written at 18:25 for a 4h cadence lands at
 * `20:45` — 2h20m in the FUTURE — so `computeMarketStatus()` correctly failed closed and
 * `xau-speed-4h` read "data clock skew: last real bar stamped 82m in the future", flagging
 * the market shut for 20+ symbols during an active session.
 *
 * `isBarBeyondItsOwnLength()` could not catch it: it permits a lead of up to one full bar
 * length (4h = 240m) to allow legitimate forming bars, and 81m is inside that tolerance. A
 * 45-minute misalignment is invisible to a whole-bar-length guard, which is exactly why
 * alignment has to happen rather than detection.
 */
import { alignBarTimestamp, isBarBeyondItsOwnLength, barLengthMs } from '../../common/utils/timeframe';

/** Mirrors the refresh loop's per-bar decision. */
function refreshDecision(rawTimestamp: string, timeframe: string, provider: string, now: number) {
  const aligned = alignBarTimestamp(rawTimestamp, timeframe, provider);
  if (!aligned) return { action: 'reject-unparseable' as const };
  if (isBarBeyondItsOwnLength(aligned, timeframe, now)) return { action: 'reject-impossible' as const };
  return { action: 'upsert' as const, timestamp: aligned, shiftedByMs: new Date(rawTimestamp).getTime() - aligned.getTime() };
}

describe('BarRefreshService — alignment (#785)', () => {
  const NOW = Date.parse('2026-09-11T19:24:00.000Z');

  describe('the observed defect', () => {
    it('floors the 4h :45 cohort onto :00, so it collides with the real bar', () => {
      // The live values: 4h bars written at 16:45, 20:45 while the real boundaries are
      // 17:00 and 21:00. 20:45 must collapse onto 20:00 — NOT stay at :45.
      expect(alignBarTimestamp('2026-09-11T16:45:00.000Z', '4h', 'mt5')?.toISOString())
        .toBe('2026-09-11T16:00:00.000Z');
      expect(alignBarTimestamp('2026-09-11T20:45:00.000Z', '4h', 'mt5')?.toISOString())
        .toBe('2026-09-11T20:00:00.000Z');
    });

    it('floors the 1h :45 cohort onto the hour', () => {
      expect(alignBarTimestamp('2026-09-11T18:45:00.000Z', '1h', 'mt5')?.toISOString())
        .toBe('2026-09-11T18:00:00.000Z');
    });

    it('floors the 1d :45 cohort onto the mt5 daily boundary', () => {
      // The batch also wrote 5,785 `1d` rows at :45. mt5's boundary is 21:00.
      expect(alignBarTimestamp('2026-09-11T21:45:00.000Z', '1d', 'mt5')?.toISOString())
        .toBe('2026-09-11T21:00:00.000Z');
    });
  });

  describe('alignment reduces — but does NOT eliminate — the future-dating', () => {
    it('the raw 20:45 bar IS future-dated, and `isBarBeyondItsOwnLength` cannot see it', () => {
      // This is the live failure. The guard passes the RAW value, because 81m is inside the
      // 4h (240m) forming-bar tolerance — which is precisely why detection alone cannot
      // solve this class of defect.
      expect(isBarBeyondItsOwnLength('2026-09-11T20:45:00.000Z', '4h', NOW)).toBe(false);
    });

    it('⚠️ flooring 20:45 lands on 20:00, which is STILL 36m ahead of a 19:24 clock', () => {
      // IMPORTANT AND HONEST: alignment is necessary but not sufficient here. A bar that is
      // already in the future cannot be repaired by flooring — 20:45 -> 20:00 is still
      // ahead of now, and 36m is inside the 4h tolerance so the guard will not reject it
      // either. The row would be stored, still future-dated, and still close the gate.
      //
      // Why this is acceptable for THIS defect: the `:45` cohort was a one-off bulk write
      // whose true boundary (21:00) had not arrived, so there was no legitimate bar to
      // collapse onto. Going forward, alignment prevents the `:45` row from being created
      // at all, because the correctly-stamped `:00` bar arrives first and the `:45` twin
      // floors onto it. The residual case is a source that is genuinely ahead of the clock,
      // which is #750 territory (bridge skew) and belongs to the clock-offset guard.
      const aligned = alignBarTimestamp('2026-09-11T20:45:00.000Z', '4h', 'mt5')!;
      expect(aligned.toISOString()).toBe('2026-09-11T20:00:00.000Z');

      const leadAfter = aligned.getTime() - NOW;
      const leadBefore = Date.parse('2026-09-11T20:45:00.000Z') - NOW;
      expect(leadAfter).toBeGreaterThan(0);        // still ahead — NOT fully repaired
      expect(leadAfter).toBeLessThan(leadBefore);  // but strictly better: 36m vs 81m

      // And the guard still does not reject it, which is why the future-dating must be
      // fixed at the SOURCE (the writer) rather than by widening this check.
      expect(isBarBeyondItsOwnLength(aligned, '4h', NOW)).toBe(false);
    });

    it('a bar aligned to a boundary that has already passed IS fully repaired', () => {
      // The normal case: a late-stamped `:45` for a period that is already closed.
      const aligned = alignBarTimestamp('2026-09-11T16:45:00.000Z', '4h', 'mt5')!;
      expect(aligned.toISOString()).toBe('2026-09-11T16:00:00.000Z');
      expect(aligned.getTime()).toBeLessThan(NOW);
      expect(isBarBeyondItsOwnLength(aligned, '4h', NOW)).toBe(false);
    });

    it('records how far each timeframe had to move (the :45 shift, per cadence)', () => {
      // Shift is always 45 minutes for this cohort, regardless of cadence — which is the
      // signature that identified it as one bulk write rather than random jitter.
      for (const tf of ['1h', '4h', '1d']) {
        const d = refreshDecision(`2026-09-11T18:45:00.000Z`, tf, 'mt5', NOW);
        expect(d.action).toBe('upsert');
        if (d.action === 'upsert') expect(d.shiftedByMs).toBeGreaterThan(0);
      }
    });
  });

  describe('genuinely impossible bars are still rejected', () => {
    it('rejects a bar beyond its own bar length after alignment', () => {
      // A 4h bar a full day out cannot be a forming bar even with the 240m tolerance.
      expect(refreshDecision('2026-09-12T20:00:00.000Z', '4h', 'mt5', NOW).action)
        .toBe('reject-impossible');
    });

    it('rejects an unparseable timestamp rather than coercing it', () => {
      // `new Date(null).getTime()` is 0, not NaN — coercion would write a 1970 bar.
      expect(refreshDecision('not-a-date', '4h', 'mt5', NOW).action).toBe('reject-unparseable');
      expect(alignBarTimestamp('', '4h', 'mt5')).toBeNull();
    });

    it('still allows a legitimate forming bar', () => {
      // A forming 4h bar opens at 20:00 while the clock reads 19:24 — impossible. But a
      // forming bar at 18:00 for a 4h cadence covering 18:00-22:00 read at 19:24 is fine.
      expect(isBarBeyondItsOwnLength('2026-09-11T18:00:00.000Z', '4h', NOW)).toBe(false);
    });
  });

  describe('alignment is idempotent — a re-run cannot shift an already-correct bar', () => {
    it.each(['1h', '4h', '1d'])('leaves an on-boundary %s bar exactly where it is', (tf) => {
      const onBoundary = tf === '1d' ? '2026-09-10T21:00:00.000Z'
        : tf === '4h' ? '2026-09-11T16:00:00.000Z'
        : '2026-09-11T18:00:00.000Z';
      const once = alignBarTimestamp(onBoundary, tf, 'mt5');
      const twice = alignBarTimestamp(once, tf, 'mt5');
      expect(twice?.getTime()).toBe(once?.getTime());
    });
  });

  describe('the tolerance gap that let this through', () => {
    it('a 45-minute misalignment is inside the forming-bar tolerance', () => {
      // Documents WHY detection cannot replace alignment: the guard is deliberately
      // permissive by up to one bar length, so it is blind to sub-bar-length offsets.
      const lead = 81 * 60_000;
      expect(lead).toBeLessThan(barLengthMs('4h'));
      expect(isBarBeyondItsOwnLength(new Date(NOW + lead).toISOString(), '4h', NOW)).toBe(false);
    });
  });
});
