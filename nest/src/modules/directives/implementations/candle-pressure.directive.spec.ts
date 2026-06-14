import { CandlePressureDirective } from './candle-pressure.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(open: number, high: number, low: number, close: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open, high, low, close, volume: 1000000 };
}

describe('CandlePressureDirective', () => {
  const directive = new CandlePressureDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(5).fill(null).map((_, i) => makeBar(100, 101, 99, 100, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect bullish candle pressure', () => {
    const bars: MarketBar[] = [];
    // Build bars with strong bullish closes
    for (let i = 0; i < 12; i++) {
      bars.push(makeBar(99, 102, 98, 101.5, 12 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(0);
  });
});
