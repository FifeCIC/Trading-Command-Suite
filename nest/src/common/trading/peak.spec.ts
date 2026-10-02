/**
 * peak.spec.ts — the durable peak record (#998).
 *
 * ⚠️ THE POINT OF THESE TESTS IS THE MONOTONIC RULE, not the arithmetic. `Math.max` is not
 * interesting; what is interesting is that a LOWER later reading must not lower the peak, and
 * that an UNKNOWN reading must not erase it. Both are silent failures if wrong: the peak simply
 * reads a little low, every downstream give-back answer is a little flattering, and nothing errors.
 *
 * ⚠️ CANARY — replaced `nextPeak`'s body with `return candidate` and confirmed the two marked
 * tests fail (and only those two, plus the sequence check). Restored, 100% pass.
 */
import { nextPeak, profitPctFor, peakProfitPctFor } from './peak';

describe('nextPeak — the high-water mark (#998)', () => {
  it('records the first observation', () => {
    expect(nextPeak(null, 100)).toBe(100);
  });

  it('raises the peak on a higher price', () => {
    expect(nextPeak(100, 101.5)).toBe(101.5);
  });

  // ⚠️ CANARY A — a peak that can go DOWN is not a peak.
  it('⚠️ CANARY — a LOWER later price does NOT lower the peak', () => {
    expect(nextPeak(100, 99)).toBe(100);
    expect(nextPeak(100, 99.999)).toBe(100);
  });

  // ⚠️ CANARY B — "we could not price it" is not evidence the peak was lower.
  it('⚠️ CANARY — an UNKNOWN candidate preserves the known peak instead of erasing it', () => {
    expect(nextPeak(100, null)).toBe(100);
    expect(nextPeak(100, undefined)).toBe(100);
    expect(nextPeak(100, NaN)).toBe(100);
    // An untrustworthy candidate must not SET a peak either.
    expect(nextPeak(null, NaN)).toBeNull();
    expect(nextPeak(null, undefined)).toBeNull();
  });

  it('returns null only when nothing was ever observed', () => {
    expect(nextPeak(null, null)).toBeNull();
  });

  it('a monotonic sequence never decreases, whatever the readings do', () => {
    const readings = [100, 103, 101, null, 99, 104.2, NaN, 90, 104.19];
    let peak: number | null = null;
    const peaks = readings.map((r) => (peak = nextPeak(peak, r)));
    expect(peaks).toEqual([100, 103, 103, 103, 103, 104.2, 104.2, 104.2, 104.2]);
    // The assertion that matters: never a decrease.
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]!).toBeGreaterThanOrEqual(peaks[i - 1]!);
    }
  });
});

describe('profitPctFor — signed profit as a percentage of entry (#998)', () => {
  it('a LONG gains when price rises', () => {
    expect(profitPctFor('buy', 100, 101)).toBeCloseTo(1, 6);
    expect(profitPctFor(null, 100, 99)).toBeCloseTo(-1, 6);
  });

  // ⚠️ CANARY C — the sign inverts for a short. Treating it as long flatters a losing short.
  it('⚠️ CANARY — a SHORT gains when price FALLS', () => {
    expect(profitPctFor('sell', 100, 99)).toBeCloseTo(1, 6);
    expect(profitPctFor('short', 100, 101)).toBeCloseTo(-1, 6);
  });

  it('an unknown side is treated as LONG (stated, not silent)', () => {
    expect(profitPctFor('', 100, 101)).toBeCloseTo(1, 6);
    expect(profitPctFor(null, 100, 101)).toBeCloseTo(1, 6);
  });

  // ⚠️ CANARY D — null, not 0. Zero is a real profit; uncomputable is not.
  it('⚠️ CANARY — uncomputable returns null, NEVER 0', () => {
    expect(profitPctFor('buy', null, 100)).toBeNull();
    expect(profitPctFor('buy', 100, null)).toBeNull();
    expect(profitPctFor('buy', 0, 100)).toBeNull(); // no divide-by-zero
    expect(profitPctFor('buy', 100, NaN)).toBeNull();
  });

  it('a genuine flat position is 0, and that is distinguishable from null', () => {
    expect(profitPctFor('buy', 100, 100)).toBe(0);
    expect(profitPctFor('buy', 100, 100)).not.toBeNull();
  });
});

describe('peakProfitPctFor — the peak of the signed percentage (#998)', () => {
  it('records the best signed percentage, not the best price', () => {
    // Entry 100: price 101 is +1%; price 99 is -1% for a long.
    const first = peakProfitPctFor(null, 'buy', 100, 101);
    expect(first).toBeCloseTo(1, 6);
    // 99 is a WORSE profit for a long, so the peak holds.
    expect(peakProfitPctFor(first, 'buy', 100, 99)).toBeCloseTo(1, 6);
  });

  it('for a SHORT the peak follows the fall, not the rise', () => {
    const first = peakProfitPctFor(null, 'sell', 100, 98);
    expect(first).toBeCloseTo(2, 6);
    expect(peakProfitPctFor(first, 'sell', 100, 99.5)).toBeCloseTo(2, 6);
    expect(peakProfitPctFor(first, 'sell', 100, 97)).toBeCloseTo(3, 6);
  });

  it('an unpriced tick preserves the peak', () => {
    expect(peakProfitPctFor(2.5, 'buy', 100, null)).toBe(2.5);
  });
});
