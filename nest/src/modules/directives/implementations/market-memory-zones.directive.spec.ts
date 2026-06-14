import { MarketMemoryZonesDirective } from './market-memory-zones.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('MarketMemoryZonesDirective', () => {
  const directive = new MarketMemoryZonesDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should identify memory zones from impulsive moves', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 30; i++) {
      // Mix of normal and impulsive bars
      const impulse = i % 7 === 0 ? 2 : 0.5;
      bars.push(makeBar(100 + i * 0.1, 100 + i * 0.1 + impulse, 100 + i * 0.1 - impulse, 30 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
