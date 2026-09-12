/**
 * EdgeStatisticsService — statistics correctness tests.
 *
 * ⚠️ WHY THESE SPECIFIC CASES
 * Statistics that are subtly wrong produce PLAUSIBLE numbers, which is the most dangerous
 * failure mode in this repo (the same shape as the scoring bugs in #750/#780/#792). So the
 * tests target the inputs where a naive implementation silently returns a confident wrong
 * answer:
 *
 *   - n = 0        -> must not claim 0% or 100% hit rate
 *   - k = n        -> Wilson must not exceed 1
 *   - tiny n       -> must yield 'insufficient', never 'edge'
 *   - large n      -> must not overflow to NaN (log-space binomial)
 *   - 50/50 split  -> p-value must be 1 (no evidence of anything)
 *
 * Reference values were checked against the standard Wilson formulae by hand.
 */
import {
  wilsonInterval,
  exactBinomialTwoSided,
  verdictFor,
} from './edge-statistics.service';

describe('wilsonInterval', () => {
  it('handles n=0 without claiming certainty', () => {
    const { low, high } = wilsonInterval(0, 0);
    expect(low).toBe(0);
    expect(high).toBe(1);
  });

  it('never produces bounds outside [0,1]', () => {
    for (const [k, n] of [[0, 5], [5, 5], [0, 100], [100, 100], [1, 3]] as const) {
      const { low, high } = wilsonInterval(k, n);
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeLessThanOrEqual(high);
    }
  });

  it('is asymmetric at the extremes (1 of 3 is not the mirror of 2 of 3 about 0.5)', () => {
    const a = wilsonInterval(1, 3);
    const b = wilsonInterval(2, 3);
    expect(a.high - 0.5).not.toBeCloseTo(0.5 - a.low, 6);
    expect(b.low).toBeLessThan(0.5);
    expect(b.high).toBeGreaterThan(0.5);
  });

  it('narrows as n grows for a fixed hit rate', () => {
    const small = wilsonInterval(52, 100);
    const large = wilsonInterval(520, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('matches the known Wilson value for 0 of 10 (approx 0 to 0.278)', () => {
    const { low, high } = wilsonInterval(0, 10);
    expect(low).toBe(0);
    expect(high).toBeCloseTo(0.2775, 3);
  });

  it('straddles 50% at 52 of 100 (not yet significant)', () => {
    const { low } = wilsonInterval(52, 100);
    expect(low).toBeLessThan(0.5);
  });

  it('clears 50% decisively at 600 of 1000', () => {
    const { low } = wilsonInterval(600, 1000);
    expect(low).toBeGreaterThan(0.5);
  });
});

describe('exactBinomialTwoSided', () => {
  it('returns 1 for a perfect 50/50 split', () => {
    expect(exactBinomialTwoSided(5, 10)).toBeCloseTo(1, 6);
  });

  it('returns 1 when n=0', () => {
    expect(exactBinomialTwoSided(0, 0)).toBe(1);
  });

  it('is 1 for a single sample (impossible to distinguish from luck)', () => {
    expect(exactBinomialTwoSided(1, 1)).toBeCloseTo(1, 6);
  });

  it('finds a large sample at 60% significant', () => {
    expect(exactBinomialTwoSided(600, 1000)).toBeLessThan(0.001);
  });

  it('finds a small sample at 60% NOT significant', () => {
    // 6/10 = 60% looks like edge but is pure noise. This is the case the whole
    // 'insufficient' verdict exists to catch.
    expect(exactBinomialTwoSided(6, 10)).toBeGreaterThan(0.05);
  });

  it('is symmetric in k and n-k', () => {
    expect(exactBinomialTwoSided(3, 10)).toBeCloseTo(exactBinomialTwoSided(7, 10), 10);
  });

  it('does not overflow for large n', () => {
    const p = exactBinomialTwoSided(5200, 10000);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeLessThan(0.001);
  });
});

describe('verdictFor — the "do not over-claim" ladder', () => {
  it('never claims edge below the minimum sample size, even at 100%', () => {
    expect(verdictFor(10, 0.9, 0.001)).toBe('insufficient');
    expect(verdictFor(29, 0.9, 0.001)).toBe('insufficient');
  });

  it('reports no-edge when the interval straddles a coin flip', () => {
    expect(verdictFor(100, 0.49, 0.9)).toBe('no-edge');
  });

  it('reports no-edge when p is not significant even if the interval clears', () => {
    expect(verdictFor(1000, 0.51, 0.4)).toBe('no-edge');
  });

  it('reports possible-edge for a cleared interval at modest n', () => {
    expect(verdictFor(100, 0.55, 0.01)).toBe('possible-edge');
  });

  it('reports edge only for a cleared interval AND a strong sample', () => {
    expect(verdictFor(500, 0.55, 0.001)).toBe('edge');
  });
});
