import { ChandelierExitDirective } from './chandelier-exit.directive';
import { SuperTrendDirective, ATRTrailingStopDirective } from './mt5-indicators.directives';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * Mirror tests for the stop-management directives used by Stop Guardian.
 * A mirrored (inverted) price series must produce the mirrored signalClass
 * with identical magnitude — this is the "side-symmetry" contract from the
 * META.Stack correctness review (MST-002 mirror tests).
 */

function makeTrend(start: number, step: number, n: number): MarketBar[] {
  const bars: MarketBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + step * i;
    bars.push({
      timestamp: new Date(Date.now() - (n - i) * 3600000),
      open: c - step * 0.8,
      high: c + step * 0.2,
      low: c - step * 1.2,
      close: c,
      volume: 1000000,
    });
  }
  return bars;
}

function mirrorBars(bars: MarketBar[]): MarketBar[] {
  const prices = bars.flatMap((b) => [b.open, b.high, b.low, b.close]);
  const pivot = (Math.min(...prices) + Math.max(...prices)) / 2;
  return bars.map((b) => ({
    ...b,
    open: 2 * pivot - b.open,
    high: 2 * pivot - b.low, // old low → new high (mirror flips the candle)
    low: 2 * pivot - b.high, // old high → new low
    close: 2 * pivot - b.close,
  }));
}

describe('stop directives — side-symmetry mirror tests', () => {
  const trend = makeTrend(100, 2, 40);
  const mirrored = mirrorBars(trend);

  it('chandelier-exit emits mirrored bullish/bearish evidence with equal magnitude', () => {
    const d = new ChandelierExitDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
    expect(up.score).toBeGreaterThan(50);
  });

  it('atr-trailing-stop emits mirrored bullish/bearish evidence with equal magnitude', () => {
    const d = new ATRTrailingStopDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });

  it('supertrend emits mirrored bullish/bearish evidence with equal magnitude', () => {
    const d = new SuperTrendDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });
});
