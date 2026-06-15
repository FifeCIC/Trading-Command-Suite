import { VolatilityEnvelopeDirective } from './volatility-envelope.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, range: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high: close + range, low: close - range, close, volume: 1000000 };
}

describe('VolatilityEnvelopeDirective', () => {
  const directive = new VolatilityEnvelopeDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 1, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect normal range conditions', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(makeBar(100, 1, 20 - i));
    const result: any = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.percentileBands).toBeDefined();
  });
});
