import { SigmaScoreDirective } from './sigma-score.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('SigmaScoreDirective', () => {
  const directive = new SigmaScoreDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect extreme z-score deviation', () => {
    const bars: MarketBar[] = [];
    // 19 stable bars, then 1 extreme jump
    for (let i = 0; i < 19; i++) {
      bars.push(makeBar(100, 101, 99, 20 - i));
    }
    bars.push(makeBar(110, 111, 109, 0));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(0);
  });
});
