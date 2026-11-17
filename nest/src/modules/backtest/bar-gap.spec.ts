import { isBarHole } from './bar-gap';

const MIN = 60_000;

/**
 * #1286 — `spansGap` must measure the step FROM THE ENTRY BAR.
 *
 * The trade loop starts at `future = day + 1` (the first forward bar). Its gap test was guarded by
 * `if (future > day + 1)`, which is FALSE on that first iteration — so the pair
 * `(bars[day], bars[day + 1])`, entry bar → first forward bar, was never measured.
 *
 * That is the hole that matters most. A position opened on the last bar before the machine sleeps
 * is unmonitored for the whole hole, and it reported `spansGap = 0`.
 *
 * These cases pin the THRESHOLD. The guard itself lives in the loop and cannot be reached from a
 * unit test; it is covered by an A/B run recorded in the issue.
 */
describe('isBarHole — the unmonitored-hole threshold (#1286)', () => {
  describe('a 5m chart: both rules reduce to "more than an hour"', () => {
    it('is NOT a hole at exactly 60 minutes — the boundary is exclusive', () => {
      expect(isBarHole(60 * MIN, 5)).toBe(false);
    });

    it('is a hole at 61 minutes', () => {
      expect(isBarHole(61 * MIN, 5)).toBe(true);
    });

    it('is NOT a hole at one missed bar (10 minutes)', () => {
      expect(isBarHole(10 * MIN, 5)).toBe(false);
    });

    it('flags the 111-hour shutdown hole that motivated the flag', () => {
      expect(isBarHole(111.3 * 60 * MIN, 5)).toBe(true);
    });
  });

  describe('a 1h chart: the floor is twelve bars, not one hour', () => {
    it('is NOT a hole at 5 hours — five missing 1h bars is not yet a hole', () => {
      expect(isBarHole(5 * 60 * MIN, 60)).toBe(false);
    });

    it('is NOT a hole at exactly 12 hours — exclusive', () => {
      expect(isBarHole(12 * 60 * MIN, 60)).toBe(false);
    });

    it('is a hole past 12 hours', () => {
      expect(isBarHole(13 * 60 * MIN, 60)).toBe(true);
    });
  });

  describe('the two rules are an AND, not an OR', () => {
    it('a sparse chart does not flag a short step that exceeds 12 bars', () => {
      // 0.1-minute bars: 12 bars = 1.2 min, which is under the 60-minute absolute floor.
      expect(isBarHole(2 * MIN, 0.1)).toBe(false);
    });

    it('a dense chart does not flag a step that is an hour but only a few bars', () => {
      // 15-minute bars: 1 hour is only 4 bars, under the 12-bar rule.
      expect(isBarHole(60 * MIN, 15)).toBe(false);
    });
  });

  describe('unmeasurable input is NOT a hole', () => {
    // A non-measurable gap must not exclude a trade's excursion from the usable population.
    it.each([
      ['NaN step', NaN, 5],
      ['NaN barMinutes', 60 * MIN, NaN],
      ['undefined step', undefined, 5],
      ['null barMinutes', 60 * MIN, null],
      ['negative step', -60 * MIN, 5],
      ['zero barMinutes', 60 * MIN, 0],
      ['Infinity barMinutes', 60 * MIN, Infinity],
    ])('%s → false', (_label, step, bar) => {
      expect(isBarHole(step, bar)).toBe(false);
    });
  });
});
