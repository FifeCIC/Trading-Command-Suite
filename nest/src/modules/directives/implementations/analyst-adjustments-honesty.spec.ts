import { AnalystAdjustmentsDirective } from './momentum-and-macro.directives';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * AnalystAdjustmentsDirective — honesty contract (2026-09-10).
 *
 * THE DEFECT THIS LOCKS OUT
 * ------------------------
 * This directive has NO analyst feed; it infers sentiment from price momentum.
 * The previous version ended with:
 *
 *     score = Math.round(30 + accelerating * 5)          // confidence 0.25
 *     signalClass = accelerating > 0 ? 'bullish' : 'bearish'
 *
 * Two faults, both measured on live data:
 *
 *  1. A FABRICATED FLOOR. `30 +` produced a non-zero score on flat momentum — a
 *     number with no market basis. Measured: 1,125 `bullish` readings averaged
 *     30.9 with a minimum of EXACTLY 30; 630 `bearish` averaged 29.7 with a
 *     maximum of EXACTLY 30. 94% of 1,755 readings fell inside a 27-50 band,
 *     i.e. inside the invented offset.
 *
 *  2. DIRECTION FROM NOISE. A tradeable direction came from the SIGN of
 *     `accelerating`, so +0.02% momentum — indistinguishable from zero —
 *     produced a full `bullish` classification. For `ftse-speed-v1` /
 *     `dax-speed-v1` / `cac-speed-v1` this was the ONLY directional directive,
 *     so that coin-flip WAS the composite.
 *
 * WHY IT MATTERS: the app may one day trade real money. When a feed stops, the
 * correct output is "I cannot measure this" — never a plausible number.
 *
 * The tests below assert the two properties that make that true:
 *   - flat momentum yields NO score and NO direction,
 *   - the result is flagged `unmeasured` so risk gating can never treat the
 *     absence of evidence as evidence.
 */

const BASE = new Date('2026-09-10T12:00:00Z');
const MIN = 60_000;

/** Build bars whose LAST 5-bar return differs from the previous one by `accelPct`. */
function barsWithAcceleration(accelPct: number, opts: { volumeSurge?: boolean } = {}): MarketBar[] {
  const out: MarketBar[] = [];
  // A flat base keeps the arithmetic legible: 100.00 throughout.
  const base = 100;
  // Previous 5-bar window moves +0, so the last window's return IS the
  // acceleration we want to test.
  const lastWindowStart = base * (1 + accelPct / 100);
  for (let i = 0; i < 16; i++) {
    out.push({
      timestamp: new Date(BASE.getTime() - (15 - i) * MIN),
      open: base,
      high: base * 1.001,
      low: base * 0.999,
      close: i < 11 ? base : lastWindowStart,
      volume: opts.volumeSurge && i === 15 ? 5_000 : 1_000,
    });
  }
  return out;
}

describe('AnalystAdjustmentsDirective — never fabricates a score or a direction', () => {
  const directive = new AnalystAdjustmentsDirective();

  it('returns NO score and NO direction on flat momentum (the fabrication)', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(0.1) });

    // The regression: this used to be score ~31 with signalClass 'bullish'.
    expect(result.score).toBe(0);
    expect(result.signalClass).toBe('neutral');
  });

  it('flags the flat case as unmeasured so risk gating ignores it', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(0.1) });
    expect(result.unmeasured).toBe(true);
  });

  it('never emits a direction from the SIGN of near-zero momentum', () => {
    // Both sides of zero must be neutral — the old code flipped a coin here.
    for (const accel of [0, 0.001, 0.1, 0.5, -0.001, -0.1, -0.5]) {
      const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(accel) });
      expect(result.signalClass).toBe('neutral');
      expect(result.score).toBe(0);
    }
  });

  it('states plainly that it could not measure, rather than implying a reading', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(0.1) });
    expect(result.reason).toMatch(/UNMEASURED/);
    expect(result.reason).toMatch(/No measurable momentum shift/);
    // It must be honest that the analyst feed is absent, not imply one exists.
    expect(result.reason).toMatch(/no analyst feed/i);
  });

  it('still reports a genuine bullish acceleration', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(1.5) });
    expect(result.signalClass).toBe('bullish');
    expect(result.score).toBe(50);
    expect(result.unmeasured).toBeUndefined();
  });

  it('still reports a genuine strong bullish acceleration with volume', () => {
    const result = directive.calculate({
      symbol: 'UK100',
      bars: barsWithAcceleration(2.5, { volumeSurge: true }),
    });
    expect(result.signalClass).toBe('bullish');
    expect(result.score).toBe(70);
  });

  it('still reports a genuine bearish deceleration', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(-2.5) });
    expect(result.signalClass).toBe('bearish');
    expect(result.score).toBe(45);
    expect(result.unmeasured).toBeUndefined();
  });

  it('treats insufficient bars as unmeasured, not as a zero reading', () => {
    const result = directive.calculate({ symbol: 'UK100', bars: [] });
    expect(result.score).toBe(0);
    expect(result.unmeasured).toBe(true);
    expect(result.signalClass).toBe('neutral');
  });

  it('never returns a score that is impossible to interpret', () => {
    // Sweep the full plausible acceleration range: every result must be either
    // an explicitly unmeasured zero or one of the three measured magnitudes.
    const allowed = new Set([0, 45, 50, 70]);
    for (let accel = -5; accel <= 5; accel += 0.05) {
      const result = directive.calculate({ symbol: 'UK100', bars: barsWithAcceleration(accel) });
      expect(allowed.has(result.score)).toBe(true);
      if (result.score === 0) expect(result.unmeasured).toBe(true);
      else expect(result.unmeasured).toBeUndefined();
    }
  });
});
