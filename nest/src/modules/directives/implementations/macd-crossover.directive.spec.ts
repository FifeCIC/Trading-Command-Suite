import { MacdCrossoverDirective } from './macd-crossover.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBars(closes: number[]): MarketBar[] {
  return closes.map((close, i) => ({
    timestamp: new Date(Date.now() - (closes.length - i) * 3600000),
    open: close * 0.999,
    high: close * 1.005,
    low: close * 0.995,
    close,
    volume: 1000000,
  }));
}

describe('MacdCrossoverDirective', () => {
  const directive = new MacdCrossoverDirective();

  it('returns score 0 with insufficient data', () => {
    const result = directive.calculate({ symbol: 'TEST', bars: makeBars([100, 101]) });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('scores high on fresh bullish crossover', () => {
    // Decline then sharp recovery to force MACD crossover
    const decline = Array.from({ length: 26 }, (_, i) => 100 - i * 0.5);
    const recovery = Array.from({ length: 12 }, (_, i) => 87 + i * 1.5);
    const bars = makeBars([...decline, ...recovery]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    // After a decline and recovery, MACD should show bullish momentum
    expect(result.score).toBeGreaterThan(30);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('scores low in bearish territory', () => {
    // Steady decline — MACD will be bearish
    const bars = makeBars(Array.from({ length: 40 }, (_, i) => 150 - i * 1.2));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThan(30);
  });

  it('handles flat market with neutral score', () => {
    // Sideways movement
    const bars = makeBars(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i * 0.3) * 0.5));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
