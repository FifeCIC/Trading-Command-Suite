/**
 * break-even.spec.ts — canary for the break-even win rate.
 *
 * ⚠️ THE TWO DIRECTIONS THAT MATTER, and both are silent failures if wrong:
 *   • a run that CLEARS the bar must not read as failing (it would send someone to "fix" a bracket
 *     that works, which is how a working configuration gets destroyed);
 *   • a run SHORT of the bar must not read as passing (the whole point — a 42% run against an 88% bar
 *     must never look acceptable).
 *
 * The numbers are the measured ones: `1bbf1860` (2.49/1.49 at 1.01% cost, 42.3% achieved) needs 88.0%.
 */
import { breakEvenWinRate, medianBracket } from './break-even';

describe('breakEvenWinRate', () => {
  it('reproduces the measured 88.0% for a target SMALLER than the stop', () => {
    const r = breakEvenWinRate({ stopPct: 2.49, targetPct: 1.49, costPct: 1.01 }, 42.3);
    expect(r.requiredWinRatePct).toBe(87.9);
    expect(r.gapPp).toBe(-45.6);
    expect(r.profitable).toBe(false);
  });

  it('reproduces the measured 57.7% for a 1.4:1 bracket', () => {
    const r = breakEvenWinRate({ stopPct: 2.47, targetPct: 3.5, costPct: 0.97 }, 22.9);
    expect(r.requiredWinRatePct).toBe(57.6);
    expect(r.gapPp).toBe(-34.7);
    expect(r.profitable).toBe(false);
  });

  it('reports a run that CLEARS the bar as profitable (the other direction)', () => {
    // Same 1.4:1 bracket, a win rate above the 57.7% it needs.
    const r = breakEvenWinRate({ stopPct: 2.47, targetPct: 3.5, costPct: 0.97 }, 62);
    expect(r.profitable).toBe(true);
    expect(r.gapPp).toBe(4.4);
  });

  it('treats a gap of exactly zero as NOT profitable — it is break-even before variance', () => {
    const r = breakEvenWinRate({ stopPct: 2, targetPct: 2, costPct: 1 }, 75);
    expect(r.requiredWinRatePct).toBeCloseTo(75, 1);
    expect(r.gapPp).toBeCloseTo(0, 1);
    expect(r.profitable).toBe(false);
  });

  it('charges MORE win rate for MORE cost — the sign of the whole model', () => {
    const cheap = breakEvenWinRate({ stopPct: 2.5, targetPct: 1.5, costPct: 0.1 }, 50);
    const dear = breakEvenWinRate({ stopPct: 2.5, targetPct: 1.5, costPct: 1.0 }, 50);
    expect(dear.requiredWinRatePct!).toBeGreaterThan(cheap.requiredWinRatePct!);
  });

  it('refuses a target that does not cover the cost, and says which reason', () => {
    const r = breakEvenWinRate({ stopPct: 2.5, targetPct: 1.0, costPct: 1.0 }, 90);
    expect(r.requiredWinRatePct).toBeNull();
    expect(r.unavailable).toBe('target-below-cost');
    expect(r.profitable).toBeNull();
  });

  it('returns null for a missing bracket rather than 0% or 100%', () => {
    for (const input of [
      { stopPct: null, targetPct: 3, costPct: 1 },
      { stopPct: 2, targetPct: null, costPct: 1 },
      { stopPct: 0, targetPct: 0, costPct: 1 },
    ]) {
      const r = breakEvenWinRate(input, 50);
      expect(r.requiredWinRatePct).toBeNull();
      expect(r.unavailable).toBe('no-bracket');
    }
  });

  it('reports the requirement even when the achieved rate is unknown', () => {
    const r = breakEvenWinRate({ stopPct: 2.5, targetPct: 3.5, costPct: 1 }, null);
    expect(r.requiredWinRatePct).toBeCloseTo(58.3, 1);
    expect(r.gapPp).toBeNull();
    expect(r.profitable).toBeNull();
  });

  it('ignores a nonsense negative cost instead of crediting it', () => {
    const r = breakEvenWinRate({ stopPct: 2.5, targetPct: 3.5, costPct: -5 }, 50);
    // A negative cost would LOWER the bar below the no-cost case; it is clamped to 0.
    expect(r.requiredWinRatePct).toBeCloseTo((2.5 / 6) * 100, 1);
  });
});

describe('medianBracket', () => {
  it('reads the bracket from the trades, as percentages of entry', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: 97.5, takeProfit: 103.5 },
      { entryPrice: 200, stopLoss: 195, takeProfit: 207 },
    ]);
    expect(r.stopPct).toBeCloseTo(2.5, 2);
    expect(r.targetPct).toBeCloseTo(3.5, 2);
    expect(r.sample).toBe(2);
  });

  it('mirrors a SHORT bracket correctly — the stop is above, the target below', () => {
    const r = medianBracket([{ entryPrice: 100, stopLoss: 102.5, takeProfit: 96.5 }]);
    expect(r.stopPct).toBeCloseTo(2.5, 2);
    expect(r.targetPct).toBeCloseTo(3.5, 2);
  });

  it('drops trades with no recorded levels and reports the sample it used', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: null, takeProfit: null },
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
    ]);
    expect(r.sample).toBe(1);
    expect(r.stopPct).toBeCloseTo(2, 2);
  });

  it('returns NULL, not zero, when nothing was recorded', () => {
    expect(medianBracket([])).toEqual({ stopPct: null, targetPct: null, sample: 0 });
    expect(medianBracket(null)).toEqual({ stopPct: null, targetPct: null, sample: 0 });
  });

  it('uses the MEDIAN, so one widened stop cannot move the number a reader acts on', () => {
    const r = medianBracket([
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
      { entryPrice: 100, stopLoss: 98, takeProfit: 104 },
      { entryPrice: 100, stopLoss: 90, takeProfit: 104 },
    ]);
    expect(r.stopPct).toBeCloseTo(2, 2);
  });
});
