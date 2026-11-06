import { assessOverfit, OVERFIT_RULES } from './overfit-verdict';

/**
 * overfit-verdict.spec.ts — the survival rule, branch by branch.
 *
 * ⚠️ CANARY (both directions, run 2026-11-06; restore and re-run before trusting):
 *   • raise `surviveRetention` to 1.5   → 'a clean retention survives' fails
 *   • drop the `inSampleWinRate <= 0` guard → 'zero in-sample retention is undefined, not 100%' fails
 *   • remove the sample-bar check       → 'a perfect ratio on 6 trades is still noise' fails
 */

const f = (over: Partial<Parameters<typeof assessOverfit>[0]> = {}) => ({
  inSampleWinRate: 0.6,
  outOfSampleWinRate: 0.5,
  inSampleTrades: 60,
  outOfSampleTrades: 40,
  ...over,
});

describe('assessOverfit — did it survive out of sample?', () => {
  it('a clean retention survives', () => {
    const r = assessOverfit(f({ inSampleWinRate: 0.6, outOfSampleWinRate: 0.5 })); // 0.833
    expect(r.verdict).toBe('survived');
    expect(r.retention).toBeCloseTo(0.8333, 3);
  });

  it('the survive threshold is INCLUSIVE — exactly 0.75 survives', () => {
    expect(assessOverfit(f({ inSampleWinRate: 0.4, outOfSampleWinRate: 0.3 })).verdict).toBe('survived');
  });

  it('just below the threshold is DECAYED, not survived', () => {
    expect(assessOverfit(f({ inSampleWinRate: 0.4, outOfSampleWinRate: 0.29 })).verdict).toBe('decayed');
  });

  it('the overfit threshold is INCLUSIVE — exactly 0.50 is decayed, 0.49 is overfit', () => {
    expect(assessOverfit(f({ inSampleWinRate: 0.4, outOfSampleWinRate: 0.2 })).verdict).toBe('decayed');
    expect(assessOverfit(f({ inSampleWinRate: 0.4, outOfSampleWinRate: 0.196 })).verdict).toBe('overfit');
  });

  it('it is a RATIO, not an absolute gap — 80→60 survives, 12→4.8 does too (both 0.75)', () => {
    expect(assessOverfit(f({ inSampleWinRate: 0.8, outOfSampleWinRate: 0.6 })).verdict).toBe('survived');
    expect(assessOverfit(f({ inSampleWinRate: 0.12, outOfSampleWinRate: 0.09 })).verdict).toBe('survived');
  });

  it('a perfect ratio on 6 trades is still noise', () => {
    const r = assessOverfit(f({ inSampleTrades: 3, outOfSampleTrades: 3 }));
    expect(r.verdict).toBe('insufficient-data');
    expect(r.retention).toBeNull(); // never computed — a ratio on no sample is a guess
  });

  it('zero in-sample retention is UNDEFINED, not 100%', () => {
    const r = assessOverfit(f({ inSampleWinRate: 0, outOfSampleWinRate: 0 }));
    expect(r.verdict).toBe('sample-unknown');
    expect(r.note).toMatch(/undefined/);
  });

  it('a missing win rate is not a zero win rate', () => {
    expect(assessOverfit(f({ outOfSampleWinRate: null })).verdict).toBe('sample-unknown');
    expect(assessOverfit(f({ inSampleTrades: null })).verdict).toBe('sample-unknown');
  });

  it('states the rule in the note so a reader never has to guess the thresholds', () => {
    const r = assessOverfit(f({ inSampleWinRate: 0.6, outOfSampleWinRate: 0.1 }));
    expect(r.note).toContain(String(OVERFIT_RULES.overfitRetention));
    expect(r.note).toMatch(/OVERFIT/);
  });
});
