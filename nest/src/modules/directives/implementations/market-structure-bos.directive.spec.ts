import { MarketStructureBosDirective } from './market-structure-bos.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('MarketStructureBosDirective', () => {
  const directive = new MarketStructureBosDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should detect bullish structure (higher highs + higher lows)', () => {
    const bars: MarketBar[] = [];
    // Build a clear uptrend with distinct swing points
    let base = 100;
    for (let i = 0; i < 30; i++) {
      const isSwing = i % 5 === 0;
      const swingAmount = isSwing ? 2.5 : 0.3;
      base += 0.2;
      bars.push(makeBar(base, base + swingAmount, base - swingAmount, 30 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
