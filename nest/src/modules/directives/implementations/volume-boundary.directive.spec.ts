import { VolumeBoundaryDirective } from './volume-boundary.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, volume: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high: close + 0.5, low: close - 0.5, close, volume };
}

describe('VolumeBoundaryDirective', () => {
  const directive = new VolumeBoundaryDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 1000000, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect volume climax', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 19; i++) bars.push(makeBar(100, 100000, 20 - i));
    // Large volume climax bar
    bars.push(makeBar(105, 10000000, 0));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(0);
  });
});
