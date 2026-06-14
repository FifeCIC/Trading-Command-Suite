import { HurstMemoryDirective } from './hurst-memory.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('HurstMemoryDirective', () => {
  const directive = new HurstMemoryDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should produce a valid Hurst estimate with sufficient data', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 50; i++) {
      bars.push(makeBar(100 + i * 0.2, 101 + i * 0.2, 99 + i * 0.2, 50 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeGreaterThan(0.1);
  });
});
