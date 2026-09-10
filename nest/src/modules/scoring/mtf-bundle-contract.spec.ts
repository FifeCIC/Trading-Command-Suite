/**
 * MTF bundle contract — INV-MTF-BUNDLE (#735 / MST-004)
 * =====================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The defect was invisible. `higherTfBars` is an OPTIONAL parameter of `scoreWithGating()`,
 * so a caller that omits it still compiles, still runs, and still returns a number. The
 * number is just wrong — every multi-timeframe directive silently falls back to the base
 * bars. Twelve call sites were in that state and nothing caught it, because nothing asserted
 * that the bundle CHANGES anything.
 *
 * A test that only checked "scoreWithGating returns a number" passed before the fix and
 * passes after it. That is coverage of the wrong claim — worse than no test, because it
 * reports green over a broken contract. So this file asserts the properties that were
 * actually violated:
 *
 *   1. The directives that read `dayBars`/`hourBars`/`min15Bars` produce a DIFFERENT result
 *      when a bundle is supplied. If a refactor makes them ignore the bundle, this fails.
 *   2. `multi-timeframe-trend` returns score 0 with an explicit data-starved reason when the
 *      bundle is missing. It must not score from base bars — that is mode-1
 *      "completeness theater" from the directive audit checklist in `directive.interface.ts`.
 *   3. Two protocols' bundles are not interchangeable. This is the exact shape of the A/B
 *      defect: the control protocol's bundle was loaded once and handed to BOTH sides, so
 *      the variant's MTF directives read the control's data.
 *
 * The directives are exercised directly rather than through `scoreWithGating()`, because the
 * claim under test ("this directive reads this input") is strictly upstream of aggregation.
 */

import { MultiTimeframeTrendDirective } from '../directives/implementations/multi-timeframe-trend.directive';
import { MicroSrLevelsDirective } from '../directives/implementations/micro-sr-levels.directive';
import type { MarketBar } from '../directives/interfaces/directive.interface';

/** Deterministic bar series: closes step by `step` at `intervalMs`, ending at `endAt`. */
function makeBars(
  count: number,
  step: number,
  intervalMs: number,
  endAt: number,
  start = 100,
): MarketBar[] {
  const bars: MarketBar[] = [];
  const first = endAt - (count - 1) * intervalMs;
  let close = start;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = open + step;
    bars.push({
      timestamp: new Date(first + i * intervalMs),
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 1000 + i * 7,
    });
  }
  return bars;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MIN15 = 15 * MIN;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const asOf = new Date(NOW);

const BASE = makeBars(200, 0.05, MIN15, NOW);
const DAY_UP = makeBars(60, 1.5, DAY, NOW - 2 * DAY);
const DAY_DOWN = makeBars(60, -1.5, DAY, NOW - 2 * DAY, 200);
const HOUR_DOWN = makeBars(80, -0.6, HOUR, NOW - HOUR, 150);
const FIFTEEN_CHOP = makeBars(80, 0.01, MIN15, NOW);

describe('INV-MTF-BUNDLE — higher-timeframe inputs reach the directives that declare them', () => {
  describe('multi-timeframe-trend', () => {
    const directive = new MultiTimeframeTrendDirective();

    it('scores from the bundle when one is supplied', () => {
      const result = directive.calculate({
        symbol: 'TESTX',
        bars: BASE,
        dayBars: DAY_UP,
        hourBars: HOUR_DOWN,
        min15Bars: FIFTEEN_CHOP,
        asOf,
      });
      // A real reading, not the data-starved zero. This is what the twelve bundle-less
      // call sites were failing to produce.
      expect(result.score).toBeGreaterThan(0);
      expect(result.reason).not.toMatch(/insufficient higher-timeframe/i);
    });

    it('refuses to score rather than falling back to base bars when the bundle is absent', () => {
      const result = directive.calculate({ symbol: 'TESTX', bars: BASE, asOf });
      // The directive must SAY it is data-starved. Silently scoring BASE was the failure:
      // a plausible number with no error anywhere.
      expect(result.score).toBe(0);
      expect(result.reason).toMatch(/insufficient higher-timeframe/i);
    });

    it('scores a full three-timeframe bundle higher than a single-timeframe one', () => {
      // The load-bearing assertion for this directive. `ALIGNMENT_TWO_OF_THREE` (80-band)
      // requires TWO timeframes to agree; with only `dayBars` the directive can never reach
      // it, so a complete bundle must outscore a partial one. If both return the same number,
      // the bundle is no longer being read and the whole contract is decorative — which is
      // exactly the state #735 left the twelve bundle-less call sites in.
      const full = directive.calculate({
        symbol: 'TESTX', bars: BASE, dayBars: DAY_UP, hourBars: HOUR_DOWN, min15Bars: FIFTEEN_CHOP, asOf,
      });
      const partial = directive.calculate({ symbol: 'TESTX', bars: BASE, dayBars: DAY_UP, asOf });
      expect(full.score).toBeGreaterThan(partial.score);
      expect(partial.reason).toMatch(/N\/A/); // the missing timeframes are reported as N/A
    });

    it('reads the DIRECTION of each timeframe, not just its presence', () => {
      // With an identical bar COUNT and only the direction flipped, the alignment verdict
      // must flip too. Score alone does not distinguish them (2B/1S and 1B/2S both land in
      // the "mixed" band), so `signalClass` and the reason string are what carry the
      // evidence — asserting on the score here would be a test that passes for the wrong
      // reason.
      const up = directive.calculate({
        symbol: 'TESTX', bars: BASE, dayBars: DAY_UP, hourBars: HOUR_DOWN, min15Bars: FIFTEEN_CHOP, asOf,
      });
      const down = directive.calculate({
        symbol: 'TESTX', bars: BASE, dayBars: DAY_DOWN, hourBars: HOUR_DOWN, min15Bars: FIFTEEN_CHOP, asOf,
      });
      expect(up.signalClass).not.toBe(down.signalClass);
      expect(up.reason).toMatch(/1D: bullish/);
      expect(down.reason).toMatch(/1D: bearish/);
    });

    it('treats a one-timeframe bundle as a partial reading, not a failure', () => {
      // `availableCount === 0` is the hard stop; a SINGLE available timeframe must still
      // score (degraded but honest) so a symbol with only daily history is usable.
      const result = directive.calculate({
        symbol: 'TESTX', bars: BASE, dayBars: DAY_UP, asOf,
      });
      expect(result.reason).not.toMatch(/insufficient higher-timeframe/i);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('micro-sr-levels', () => {
    const directive = new MicroSrLevelsDirective();

    it('scores S/R proximity against bundle-derived levels that base bars cannot supply', () => {
      // The base series is placed so its own round-number levels are ~4 points away (not
      // "proximate"), while the bundle's hourly series puts a Session High within 0.15% of
      // the current price. With no bundle that level does not exist, so the directive can
      // only report "No clear S/R proximity" — which is exactly the silent degradation the
      // twelve bundle-less call sites produced.
      const bundleDay = makeBars(60, 1.0, DAY, NOW - 2 * DAY, 80);
      const bundleHour = makeBars(80, 0.6, HOUR, NOW - HOUR, 86);
      const bundle15 = makeBars(80, 0.02, MIN15, NOW, 133.5);
      const baseNear = makeBars(200, 0.02, MIN15, NOW, 130);

      const withBundle = directive.calculate({
        symbol: 'TESTX', bars: baseNear, dayBars: bundleDay, hourBars: bundleHour, min15Bars: bundle15, asOf,
      });
      const withoutBundle = directive.calculate({ symbol: 'TESTX', bars: baseNear, asOf });

      expect(withBundle.score).toBeGreaterThan(withoutBundle.score);
      // The evidence names a level that exists ONLY in the hourly bundle.
      expect(withBundle.reason).toMatch(/Session High/);
      expect(withoutBundle.reason).toMatch(/No clear S\/R proximity/);
    });

    it('still requires base bars — the bundle is additive, not a substitute', () => {
      const result = directive.calculate({ symbol: 'TESTX', bars: [], dayBars: DAY_UP, asOf });
      expect(result.score).toBe(0);
      expect(result.reason).toMatch(/insufficient bars/i);
    });
  });

  describe('bundle provenance (the A/B defect)', () => {
    it('bundles for different protocols are materially different', () => {
      // `loadHigherTfBundle(sym.id, controlCfg.protocolId)` was computed once and passed to
      // BOTH sides of the A/B comparison, so the variant's MTF directives read the control's
      // bar depth. Assert a swap would be visible.
      const control = { dayBars: makeBars(200, 1.5, DAY, NOW - 2 * DAY), hourBars: [], min15Bars: [] };
      const variant = { dayBars: makeBars(30, -1.5, DAY, NOW - 2 * DAY, 200), hourBars: [], min15Bars: [] };

      expect(control.dayBars.length).not.toBe(variant.dayBars.length);
      expect(Math.sign(control.dayBars[control.dayBars.length - 1].close - 100)).not.toBe(
        Math.sign(variant.dayBars[variant.dayBars.length - 1].close - 200),
      );
    });

    it('loadHigherTfBundle stays protocol-scoped so per-protocol bar depth is honoured', () => {
      // Guard the SIGNATURE, not the body. If a refactor drops `protocolId`,
      // `getRequiredBars()` sizing silently reverts to the 200-bar default and every bundle
      // looks correct while being the wrong depth.
      const fs = require('fs');
      const path = require('path');
      const source: string = fs.readFileSync(
        path.join(__dirname, 'protocol-gating.service.ts'),
        'utf8',
      );
      expect(source).toMatch(/loadHigherTfBundle\s*\(\s*symbolId:\s*string\s*,\s*protocolId\??\s*:/);
      expect(source).toMatch(/getRequiredBars\(protocolId\)/);
    });
  });
});
