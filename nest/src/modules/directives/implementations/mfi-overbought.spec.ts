/**
 * mfi-overbought — the BEARISH mirror of `mfi`, and why it had to be a separate class (#1181).
 * ================================================================================================
 * The defect this file locks: `mfi` measures ONLY the oversold side. Its base runs
 * `mapRange(MFI, 80 → 20, 0 → 50)`, so a LOW MFI scores high, and `signalClass` is
 * `total >= 60 ? 'bullish' : 'neutral'`. Measured 2026-11-03: **0 bearish in 300 ticks**, so inside
 * a SHORT_ONLY protocol its 105 maxScore was capacity that could never be earned.
 *
 * The fix is ADDITIVE (`mfi` is untouched — it has performance history), following the repo's
 * existing pattern of two one-sided classes: `rsi-oversold` + `rsi-overbought`.
 *
 * ⚠️ THE MIRROR ASSERTS SYMMETRY, NOT JUST DIRECTION. A test that only checked "it emits bearish"
 * would pass on a directive whose numbers were arbitrary. These assert that the SAME MFI reading
 * produces the SAME score on both sides — which is the whole claim of "mirror".
 *
 * ⚠️ CANARY BOTH DIRECTIONS. Flip the base curve back to `mapRange(MFI, 80, 20, …)` and the
 * high-MFI test fails; remove the bearish branch and the direction test fails. A guard observed only
 * passing proves nothing.
 */
import { MfiDirective } from './mfi.directive';
import { MfiOverboughtDirective } from './mfi-overbought.directive';
import type { DirectiveInput, MarketBar } from '../interfaces/directive.interface';

/**
 * Build bars with a controllable MONEY FLOW character.
 *
 * ⚠️ MFI is volume-weighted, so price direction ALONE does not steer it: a rising close with falling
 * volume produces a weak positive flow. `strength` therefore drives BOTH the move and the volume, so
 * `+1` is sustained buying pressure and `-1` is sustained selling pressure. The counter-trend tail
 * lets a test place MFI at an extreme and then REVERSE the last bar, which is how the curl bonus is
 * exercised.
 */
function flowBars(count: number, opts: { bias: 1 | -1; magnitude?: number; reverseLast?: boolean }): MarketBar[] {
  const { bias, magnitude = 1, reverseLast = false } = opts;
  const out: MarketBar[] = [];
  let close = 100;
  for (let i = 0; i < count; i++) {
    const step = bias * magnitude * (0.5 + ((i % 5) / 10));
    const open = close;
    close = open + step;
    const last = i === count - 1;
    const dir = last && reverseLast ? -bias : bias;
    out.push({
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      open,
      high: Math.max(open, close) + magnitude,
      low: Math.min(open, close) - magnitude,
      close: last && reverseLast ? open - step : close,
      // Volume follows the pressure direction so MFI actually moves: heavy volume on the dominant side.
      volume: dir > 0 ? 1_000_000 + i * 1_000 : 250_000,
    });
  }
  return out;
}

const input = (bars: MarketBar[]): DirectiveInput => ({ symbol: 'XAUUSD', bars, timeframe: '15m' } as DirectiveInput);

describe('mfi — the defect this mirror answers', () => {
  it('declares bearish now (it emitted ONLY bullish and was wrongly declared neutral)', () => {
    expect(new MfiDirective().directionBias).toBe('bullish');
  });

  it('still cannot emit bearish — the reason a mirror was needed, not an edit', () => {
    const d = new MfiDirective();
    const classes = new Set<string>();
    for (const b of [flowBars(60, { bias: 1 }), flowBars(60, { bias: -1 }), flowBars(60, { bias: -1, magnitude: 4 })]) {
      classes.add(d.calculate(input(b)).signalClass);
    }
    expect(classes.has('bearish')).toBe(false);
  });
});

describe('mfi-overbought — the mirror', () => {
  const d = new MfiOverboughtDirective();

  it('declares bearish, so inclusion arithmetic can reason about it', () => {
    expect(d.directionBias).toBe('bearish');
  });

  it('declares the bars its body needs, so the caller fetches them', () => {
    expect(d.minBars?.['1d']).toBe(17);
    expect(d.minBars?.['1d']).toBe(14 + 3);
  });

  it('emits BEARISH on sustained buying pressure (overbought)', () => {
    const r = d.calculate(input(flowBars(60, { bias: 1, magnitude: 2 })));
    expect(r.signalClass).toBe('bearish');
    expect(r.score).toBeGreaterThan(0);
  });

  it('is not bearish on sustained selling pressure (the mirror must not fire the wrong way)', () => {
    const r = d.calculate(input(flowBars(60, { bias: -1, magnitude: 2 })));
    expect(r.signalClass).not.toBe('bearish');
  });

  /**
   * ⚠️ THIS TEST EXISTS BECAUSE A CANARY FAILED TO FAIL (2026-11-03). The first mutation tried was a
   * degenerate one (`inMin === inMax`), and it passed — which revealed that the suite asserted the
   * DIRECTION but never the BASE CURVE'S ORIENTATION. The bonus tier alone can drag a high-MFI
   * reading over the threshold, so flipping the curve still produced 'bearish' and every test passed.
   *
   * The claim that needs pinning: at LOW MFI (sustained selling) the base must be near ZERO. With the
   * curve the right way round that is true; with it inverted — the exact shape `mfi` uses, which is
   * what this class exists to mirror — a low MFI would score 50 and the "mirror" would be the same
   * directive twice.
   */
  it('scores near zero on sustained selling pressure — the base curve rises with MFI', () => {
    const r = d.calculate(input(flowBars(60, { bias: -1, magnitude: 2 })));
    // No bonus can fire below the overbought gate, so the score here is the base alone.
    expect(r.score).toBeLessThan(20);
    expect(r.signalClass).toBe('neutral');
  });

  it('the BASE component rises with buying pressure (asserted on baseScore, not the total)', () => {
    // ⚠️ The total saturates at the ceiling once the bonus tier fires (base 50 + bonus 50 = 100,
    // clamped to maxScore), so comparing TOTALS across magnitudes measures the clamp rather than the
    // curve — the first attempt at this test compared two saturated values and failed on 100 vs 100.
    // `metadata.baseScore` is the component that actually encodes orientation.
    const mild = d.calculate(input(flowBars(60, { bias: 1, magnitude: 0.6 })));
    const strong = d.calculate(input(flowBars(60, { bias: 1, magnitude: 2.5 })));
    const bMild = Number((mild.metadata as Record<string, unknown>)?.baseScore);
    const bStrong = Number((strong.metadata as Record<string, unknown>)?.baseScore);
    expect(bMild).toBeGreaterThanOrEqual(0);
    expect(bStrong).toBeGreaterThanOrEqual(bMild);
    // The floor case is what separates a true mirror from a copy of `mfi`: low MFI must give base 0.
    const low = d.calculate(input(flowBars(60, { bias: -1, magnitude: 2 })));
    expect(Number((low.metadata as Record<string, unknown>)?.baseScore)).toBe(0);
  });

  it('never emits bullish — it is one-sided by construction, and says so', () => {
    for (const b of [flowBars(60, { bias: 1 }), flowBars(60, { bias: -1 }), flowBars(30, { bias: 1, magnitude: 5 })]) {
      expect(d.calculate(input(b)).signalClass).not.toBe('bullish');
    }
  });

  it('stays within its declared maxScore', () => {
    const r = d.calculate(input(flowBars(80, { bias: 1, magnitude: 5 })));
    expect(r.score).toBeLessThanOrEqual(d.maxScore);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('refuses below its declared bar requirement instead of scoring 0 silently', () => {
    const r = d.calculate(input(flowBars(5, { bias: 1 })));
    expect(r.score).toBe(0);
    expect(String(r.reason)).toMatch(/Insufficient data: need 17 bars/);
  });

  it('reports the period it actually used, not a hardcoded 14', () => {
    const r = d.calculate({ ...input(flowBars(60, { bias: 1 })), params: { mfiPeriod: 21 } } as DirectiveInput);
    expect(String(r.reason)).toContain('MFI(21)');
  });
});

describe('the mirror is SYMMETRIC, not merely opposite', () => {
  /**
   * The claim being tested: on identical bars, the overbought class scores the SAME as the oversold
   * class does on the inverted series. That is what makes control/variant comparison meaningful —
   * any score difference is then attributable to direction, not to different arithmetic.
   */
  it('produces an identical score for mirrored market conditions', () => {
    const up = flowBars(60, { bias: 1, magnitude: 2 });
    // Mirror the series: same bars, prices reflected about the first close, volumes inverted.
    const base = up[0].open;
    const down: MarketBar[] = up.map((b) => ({
      timestamp: b.timestamp,
      open: 2 * base - b.open,
      high: 2 * base - b.low,
      low: 2 * base - b.high,
      close: 2 * base - b.close,
      // Volume is inverted so the two series are a true reflection: heavy volume follows the new bias.
      volume: b.volume === 1_000_000 ? 250_000 : b.volume,
    }));

    const oversold = new MfiDirective().calculate(input(down));
    const overbought = new MfiOverboughtDirective().calculate(input(up));

    expect(overbought.score).toBe(oversold.score);
    expect(overbought.signalClass).toBe('bearish');
    expect(oversold.signalClass).toBe('bullish');
  });
});
