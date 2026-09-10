/**
 * Adaptive Target spec — 2026-09-10
 *
 * The load-bearing test here is MONOTONICITY. Every other behaviour is a convenience;
 * "the target never falls" is the property that stops the mechanism hiding a broken
 * directive, so it is asserted directly rather than inferred from the implementation.
 */
import {
  resolveAdaptiveTarget,
  observeAdaptiveTarget,
  adaptiveTargetReasonText,
  ADAPTIVE_TARGET_MIN_SAMPLES,
  ADAPTIVE_TARGET_FLOOR_RATIO,
  type AdaptiveTargetState,
} from './adaptive-target';

const state = (o: Partial<AdaptiveTargetState> = {}): AdaptiveTargetState => ({
  enabled: true,
  peak: null,
  samples: 0,
  since: null,
  ...o,
});

const ENOUGH = ADAPTIVE_TARGET_MIN_SAMPLES + 1;

describe('adaptive-target', () => {
  describe('resolveAdaptiveTarget', () => {
    it('uses configured capacity when the target is off (the default)', () => {
      const r = resolveAdaptiveTarget(state({ enabled: false, peak: 200, samples: ENOUGH }), 910);
      expect(r.denominator).toBe(910);
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('not-enabled');
    });

    it('uses configured capacity until enough observations exist', () => {
      const r = resolveAdaptiveTarget(
        state({ peak: 200, samples: ADAPTIVE_TARGET_MIN_SAMPLES - 1 }),
        910,
      );
      expect(r.denominator).toBe(910);
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('insufficient-samples');
    });

    it('applies the observed peak once it rests on enough samples', () => {
      const r = resolveAdaptiveTarget(state({ peak: 228, samples: ENOUGH }), 910);
      expect(r.denominator).toBe(228);
      expect(r.applied).toBe(true);
      // Both numbers are always returned so no caller is left guessing its scale.
      expect(r.configuredMax).toBe(910);
      expect(r.adaptiveMax).toBe(228);
    });

    it('never lets the target exceed configured capacity', () => {
      // A peak above capacity would be a denominator bug; clamp rather than trust it.
      const r = resolveAdaptiveTarget(state({ peak: 5000, samples: ENOUGH }), 910);
      expect(r.denominator).toBeLessThanOrEqual(910);
    });

    it('floors a near-zero peak so a dead protocol stays visibly dead', () => {
      // spy-speed-v1 historically peaked at ~3% of capacity. If the target were allowed
      // to equal that peak, a dead protocol would read as ~100% and look healthy.
      const configured = 1000;
      const r = resolveAdaptiveTarget(state({ peak: 30, samples: ENOUGH }), configured);
      expect(r.denominator).toBe(configured * ADAPTIVE_TARGET_FLOOR_RATIO);
      // i.e. 30/250 = 12%, not 30/30 = 100%.
      expect((30 / r.denominator) * 100).toBeLessThan(20);
    });

    it('falls back when there is no peak or no usable capacity', () => {
      expect(resolveAdaptiveTarget(state({ peak: null, samples: ENOUGH }), 910).reason).toBe('no-peak');
      expect(resolveAdaptiveTarget(state({ peak: 200, samples: ENOUGH }), 0).reason).toBe('no-peak');
    });
  });

  describe('observeAdaptiveTarget — monotonicity (the property that matters)', () => {
    it('raises the peak on a new high', () => {
      const out = observeAdaptiveTarget(state({ peak: 100, samples: 5 }), 150);
      expect(out?.peak).toBe(150);
      expect(out?.samples).toBe(6);
      expect(out?.since).toBeInstanceOf(Date);
    });

    it('NEVER lowers the peak — a quiet spell must not re-baseline the protocol', () => {
      const prev = state({ peak: 300, samples: 50, since: new Date('2026-01-01') });
      // A long run of poor readings, including zeros, must leave the peak untouched.
      for (const raw of [10, 5, 1, 0, 40, 200, 299]) {
        const out = observeAdaptiveTarget(prev, raw);
        expect(out).toBeNull(); // null = "nothing to persist"
      }
      expect(prev.peak).toBe(300);
    });

    it('reports an unchanged peak as null so callers skip the write', () => {
      expect(observeAdaptiveTarget(state({ peak: 200, samples: 10 }), 200)).toBeNull();
      expect(observeAdaptiveTarget(state({ peak: 200, samples: 10 }), 199)).toBeNull();
    });

    it('ignores non-positive readings — absence is not evidence about the ceiling', () => {
      expect(observeAdaptiveTarget(state({ peak: 100, samples: 5 }), 0)).toBeNull();
      expect(observeAdaptiveTarget(state({ peak: 100, samples: 5 }), -50)).toBeNull();
      expect(observeAdaptiveTarget(state(), Number.NaN)).toBeNull();
    });

    it('establishes a peak from the first positive reading', () => {
      const out = observeAdaptiveTarget(state(), 140);
      expect(out?.peak).toBe(140);
      expect(out?.samples).toBe(1);
      expect(out?.since).toBeInstanceOf(Date);
    });

    it('preserves `since` across raises so the UI can say how long the target has held', () => {
      const since = new Date('2026-03-01');
      const out = observeAdaptiveTarget(state({ peak: 100, samples: 9, since }), 180);
      expect(out?.since).toBe(since);
    });

    it('a monotonic peak combined with the floor cannot promote a dead protocol', () => {
      // End-to-end of the risky path: many low readings, one tiny peak, then resolve.
      let s = state();
      for (const raw of [3, 4, 2, 5, 3, 6, 4, 3, 5, 2, 4, 3, 6, 5, 4, 3, 2, 5, 4, 6, 5, 3]) {
        const o = observeAdaptiveTarget(s, raw);
        if (o) s = { ...s, ...o };
      }
      const r = resolveAdaptiveTarget(s, 1000);
      const pct = (6 / r.denominator) * 100;
      expect(pct).toBeLessThan(5); // still reads as useless, correctly
    });
  });

  describe('adaptiveTargetReasonText', () => {
    it('explains every branch rather than leaving the number unexplained', () => {
      const configured = 910;
      expect(
        adaptiveTargetReasonText(resolveAdaptiveTarget(state({ enabled: false }), configured)),
      ).toMatch(/off/i);
      expect(
        adaptiveTargetReasonText(resolveAdaptiveTarget(state({ samples: 1, peak: 10 }), configured)),
      ).toMatch(/too few/i);
      expect(
        adaptiveTargetReasonText(resolveAdaptiveTarget(state({ peak: null, samples: ENOUGH }), configured)),
      ).toMatch(/no peak/i);
      expect(
        adaptiveTargetReasonText(resolveAdaptiveTarget(state({ peak: 228, samples: ENOUGH }), configured)),
      ).toMatch(/observed peak/i);
    });
  });
});
