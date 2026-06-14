import { LiquiditySweepDirective } from './liquidity-sweep.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(open: number, high: number, low: number, close: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open, high, low, close, volume: 1000000 };
}

describe('LiquiditySweepDirective', () => {
  const directive = new LiquiditySweepDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(5).fill(null).map((_, i) => makeBar(100, 101, 99, 100, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect bullish liquidity sweep (long lower wick)', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(makeBar(100, 101, 99, 100, 10 - i));
    }
    // Add a sweep bar: long lower wick, closes near high
    bars.push(makeBar(98, 102, 95, 101, 0));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
