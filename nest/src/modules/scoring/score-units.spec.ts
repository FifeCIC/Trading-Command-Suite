import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeScorePercent, selectDirectionalEvidence } from './score-units';

describe('META.Stack score units', () => {
  it('gives different protocol maxima identical percentages', () => {
    expect(normalizeScorePercent(30, 100)).toBe(30);
    expect(normalizeScorePercent(120, 400)).toBe(30);
  });

  it('does not let bearish runtime evidence increase LONG_ONLY strength', () => {
    expect(selectDirectionalEvidence('LONG_ONLY', {
      bullishRaw: 20, bullishMax: 100, bearishRaw: 180, bearishMax: 200,
    })).toEqual({ direction: 'bullish', raw: 20, maximum: 100, percentage: 20 });
  });

  it('selects the intended side for SHORT_ONLY', () => {
    expect(selectDirectionalEvidence('SHORT_ONLY', {
      bullishRaw: 100, bullishMax: 100, bearishRaw: 70, bearishMax: 100,
    }).direction).toBe('bearish');
  });

  it('abstains when the protocol\'s own side has no evidence, and clamps invalid percentages', () => {
    // LONG_ONLY with zero bullish capacity has nothing to report — the side is fixed by the
    // protocol, so bearish evidence cannot substitute for it. (Under the removed BOTH mode
    // this case chose a winner by comparing two percentages on different, moving scales —
    // #813.)
    expect(selectDirectionalEvidence('LONG_ONLY', {
      bullishRaw: 0, bullishMax: 0, bearishRaw: 100, bearishMax: 200,
    }).direction).toBe('none');
    expect(selectDirectionalEvidence('SHORT_ONLY', {
      bullishRaw: 100, bullishMax: 200, bearishRaw: 0, bearishMax: 0,
    }).direction).toBe('none');
    expect(normalizeScorePercent(200, 100)).toBe(100);
    expect(normalizeScorePercent(1, 0)).toBe(0);
  });

  /**
   * #818 — `BOTH` mode was removed, and this test exists so it is not quietly re-added.
   *
   * BOTH chose its side at runtime by comparing two percentages normalised by different,
   * MOVING denominators (`bullishMax`/`bearishMax` only accumulate the directives that read
   * that way this tick). So the side could flip on PARTICIPATION rather than strength — the
   * #758 defect at a layer ADR-011's guard does not reach. That was #813.
   *
   * Measured 2026-09-15: BOTH had produced 51 ticks EVER vs 8,837 LONG_ONLY, and ZERO of the
   * 19 active protocols used it. Deletion was smaller than patching and closed #813 outright.
   *
   * Direction is now a property of the PROTOCOL, not a runtime decision.
   */
  it('has no BOTH mode — the source must not reintroduce a runtime side comparison', () => {
    const src = readFileSync(join(__dirname, 'score-units.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/['"]BOTH['"]/);
    expect(code).not.toMatch(/bullishPct|bearishPct/);
  });
});
