import { RangeContractionDirective } from './range-contraction.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, range: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high: close + range, low: close - range, close, volume: 1000000 };
}

describe('RangeContractionDirective', () => {
  const directive = new RangeContractionDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 1, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect range contraction', () => {
    const bars: MarketBar[] = [];
    // Wide-range bars first, then compressing
    for (let i = 0; i < 10; i++) bars.push(makeBar(100, 3, 30 - i));
    for (let i = 0; i < 10; i++) bars.push(makeBar(100, 2, 20 - i));
    for (let i = 0; i < 10; i++) bars.push(makeBar(100, 0.5, 10 - i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(0);
  });
});
