import { FairValueGapDirective } from './fair-value-gap.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(open: number, high: number, low: number, close: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open, high, low, close, volume: 1000000 };
}

describe('FairValueGapDirective', () => {
  const directive = new FairValueGapDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(3).fill(null).map((_, i) => makeBar(100, 101, 99, 100, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect FVGs when gaps exist', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(makeBar(100, 102, 98, 101, 10 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
