import { PatternDensitySrDirective } from './pattern-density-sr.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('PatternDensitySrDirective', () => {
  const directive = new PatternDensitySrDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should calculate pattern density S/R zones', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 40; i++) {
      // Create some swing points
      const swing = i % 8 === 0 ? 2 : 0.3;
      bars.push(makeBar(100 + Math.sin(i / 5) * 2, 100 + Math.sin(i / 5) * 2 + swing, 100 + Math.sin(i / 5) * 2 - swing, 40 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
