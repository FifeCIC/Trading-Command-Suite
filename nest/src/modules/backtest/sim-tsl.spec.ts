import { simTslPlan } from './sim-tsl';

/**
 * #1294 — the bot's simulated trailing stop had never reached the engine.
 *
 * These pin the TRANSLATION and, more importantly, the refusal cases: an enabled switch with unusable
 * numbers must produce no plan at all, because a defaulted number would tighten stops on a bot whose
 * owner never asked for it.
 */
describe('simTslPlan — bot fields → StopPlan (#1294)', () => {
  it('maps activation → lockAtPct and distance → trailPct', () => {
    expect(simTslPlan(true, 1, 0.5)).toEqual({ lockAtPct: 1, trailPct: 0.5 });
  });

  it('accepts a tinyint 1 as ON — the column is tinyint(1), not boolean', () => {
    expect(simTslPlan(1, 2, 1)).toEqual({ lockAtPct: 2, trailPct: 1 });
  });

  describe('no plan when the bot has not asked for one', () => {
    it.each([
      ['false', false],
      ['0', 0],
      ['null', null],
      ['undefined', undefined],
    ])('enabled=%s → null', (_label, enabled) => {
      expect(simTslPlan(enabled, 1, 0.5)).toBeNull();
    });
  });

  describe('a half-built plan is refused, never defaulted', () => {
    it.each([
      ['distance null', 1, null],
      ['distance 0', 1, 0],
      ['distance negative', 1, -0.5],
      ['distance NaN', 1, Number.NaN],
      ['activation null', null, 0.5],
      ['activation 0', 0, 0.5],
      ['activation NaN', Number.NaN, 0.5],
    ])('%s → null', (_label, activation, distance) => {
      expect(simTslPlan(true, activation, distance)).toBeNull();
    });
  });

  it('0 activation is NOT a plan — a stop that locks at breakeven immediately is a different strategy', () => {
    // Guarded explicitly because `0` is a number an operator could plausibly enter meaning "as soon as
    // possible". Treating it as a valid lock would silently move the stop to breakeven on the first
    // favourable tick, which is not what the field says.
    expect(simTslPlan(true, 0, 0.5)).toBeNull();
  });
});
