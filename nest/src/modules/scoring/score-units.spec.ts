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

  it('selects the intended side for SHORT_ONLY and BOTH', () => {
    expect(selectDirectionalEvidence('SHORT_ONLY', {
      bullishRaw: 100, bullishMax: 100, bearishRaw: 70, bearishMax: 100,
    }).direction).toBe('bearish');
    expect(selectDirectionalEvidence('BOTH', {
      bullishRaw: 120, bullishMax: 400, bearishRaw: 60, bearishMax: 100,
    }).direction).toBe('bearish');
  });

  it('abstains on a BOTH tie and clamps invalid percentages', () => {
    expect(selectDirectionalEvidence('BOTH', {
      bullishRaw: 50, bullishMax: 100, bearishRaw: 100, bearishMax: 200,
    }).direction).toBe('none');
    expect(normalizeScorePercent(200, 100)).toBe(100);
    expect(normalizeScorePercent(1, 0)).toBe(0);
  });
});
