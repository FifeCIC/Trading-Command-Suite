import { StochasticDirective } from './stochastic.directive';
import { VwapDirective } from './vwap.directive';
import { GoldRoundNumbersDirective } from './gold-round-numbers.directive';
import {
  DonchianBreakoutDirective,
  AwesomeOscillatorDirective,
  ChaikinMoneyFlowDirective,
  IchimokuCloudDirective,
} from './mt5-indicators.directives';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * Side-symmetry mirror tests for oscillator/trend directives fixed in the
 * 2026-09-08 directive sweep (issue #731): Stochastic, VWAP, Donchian.
 * A mirrored (inverted) price series must produce the mirrored signalClass
 * with identical magnitude.
 */

function makeBars(closes: number[]): MarketBar[] {
  return closes.map((c, i) => ({
    timestamp: new Date(Date.now() - (closes.length - i) * 3600000),
    open: c + 0.4,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000000,
  }));
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

describe('indicator directives — side-symmetry mirror tests', () => {
  const trend = makeBars(Array.from({ length: 30 }, (_, i) => 100 + i * 2)); // 100 → 158
  const mirrored = mirrorBars(trend);

  it('stochastic emits mirrored bullish/bearish and never exceeds maxScore', () => {
    const d = new StochasticDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bearish'); // overbought in an uptrend
    expect(down.signalClass).toBe('bullish'); // oversold in a downtrend
    expect(down.score).toBe(up.score);
    expect(up.score).toBeLessThanOrEqual(d.maxScore);
    expect(down.score).toBeLessThanOrEqual(d.maxScore);
  });

  it('vwap emits bullish above and bearish below with equal magnitude', () => {
    const d = new VwapDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
    expect(up.score).toBeGreaterThan(50);
  });

  it('donchian measures breakout against prior bars (excludes active candle)', () => {
    const d = new DonchianBreakoutDirective();
    const up = d.calculate({ symbol: 'X', bars: trend });
    const down = d.calculate({ symbol: 'X', bars: mirrored });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });

  it('stochastic deep oversold clamps to maxScore (no >100 overflow)', () => {
    const d = new StochasticDirective();
    // Long steady decline then a final bar at the low → deep oversold %K.
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i * 2); // 100 → 42
    const result = d.calculate({ symbol: 'X', bars: makeBars(closes) });
    expect(result.signalClass).toBe('bullish');
    expect(result.score).toBeLessThanOrEqual(d.maxScore);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('awesome-oscillator emits mirrored bullish/bearish (aligned fast/slow SMA)', () => {
    const d = new AwesomeOscillatorDirective();
    // Accelerating rise → AO positive and rising; the mirror → falling red.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.1);
    const up = d.calculate({ symbol: 'X', bars: makeBars(closes) });
    const down = d.calculate({ symbol: 'X', bars: mirrorBars(makeBars(closes)) });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });

  it('chaikin-mf emits mirrored accumulation/distribution (includes current bar)', () => {
    const d = new ChaikinMoneyFlowDirective();
    // Close drifts further above the bar midpoint over time → MFM rises → CMF rises.
    const n = 30;
    const bars: MarketBar[] = [];
    for (let i = 0; i < n; i++) {
      const c = 100 + i * 2;
      const delta = 0.2 + i * 0.05;
      const mid = c - delta;
      bars.push({
        timestamp: new Date(Date.now() - (n - i) * 3600000),
        open: mid - 0.5,
        high: mid + 1,
        low: mid - 1,
        close: c,
        volume: 1000000,
      });
    }
    const up = d.calculate({ symbol: 'X', bars });
    const down = d.calculate({ symbol: 'X', bars: mirrorBars(bars) });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });

  it('ichimoku-cloud emits mirrored bullish/bearish (displaced cloud)', () => {
    const d = new IchimokuCloudDirective();
    const closes = Array.from({ length: 78 }, (_, i) => 100 + i * 2); // 100 → 254
    const up = d.calculate({ symbol: 'X', bars: makeBars(closes) });
    const down = d.calculate({ symbol: 'X', bars: mirrorBars(makeBars(closes)) });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(down.score).toBe(up.score);
  });

  it('gold-round-numbers emits mirrored bullish/bearish around a major level with equal magnitude', () => {
    const d = new GoldRoundNumbersDirective();
    // XAUUSD just ABOVE $2600 (major) → potential support → bullish, magnitude 25.
    const above = d.calculate({
      symbol: 'XAUUSD',
      bars: makeBars([2593, 2597, 2602]),
    });
    // XAUUSD just BELOW $2600 → potential resistance → bearish, SAME magnitude 25.
    const below = d.calculate({
      symbol: 'XAUUSD',
      bars: makeBars([2595, 2597, 2598]),
    });
    expect(above.signalClass).toBe('bullish');
    expect(below.signalClass).toBe('bearish');
    expect(below.score).toBe(above.score);
    expect(above.score).toBeGreaterThan(0);
    expect(above.score).toBeLessThanOrEqual(d.maxScore);
    expect(below.score).toBeGreaterThanOrEqual(0);
  });

  it('gold-round-numbers ignores non-gold symbols', () => {
    const d = new GoldRoundNumbersDirective();
    const r = d.calculate({ symbol: 'SPY', bars: makeBars([500, 501, 502]) });
    expect(r.signalClass).toBe('neutral');
    expect(r.score).toBe(0);
  });
});
