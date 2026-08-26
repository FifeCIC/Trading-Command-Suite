import { RsiOversoldDirective } from './rsi-oversold.directive';
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

describe('RsiOversoldDirective', () => {
  const directive = new RsiOversoldDirective();

  it('returns score 0 with insufficient data', () => {
    const result = directive.calculate({ symbol: 'TEST', bars: makeBars([100, 101, 102]) });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('scores high when RSI is oversold and curling up', () => {
    // Simulate a decline followed by slight recovery to push RSI below 30 then curl
    const declining = Array.from({ length: 14 }, (_, i) => 100 - i * 2);
    const recovery = [72, 71, 70, 69]; // slight uptick at end
    declining.push(...recovery);
    // Force RSI low by making a sharp drop then small bounce
    const bars = makeBars([
      100, 99, 97, 95, 92, 89, 85, 82, 78, 74, 70, 67, 64, 61, 59, 58, 58.5,
    ]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(50);
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('scores low when RSI is well above threshold', () => {
    // Steady uptrend — RSI will be high
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 100 + i * 2));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThan(30);
  });

  it('handles RSI exactly at threshold (30)', () => {
    // Gentle decline that targets RSI around 30
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.8));
    const result = directive.calculate({ symbol: 'TEST', bars });
    // At or near threshold — should not crash. Hybrid scoring (base 0-50 +
    // bonus up to 80 + curl 10) has maxScore 140, NOT 100 — see
    // rsi-oversold.directive.ts. Assert against the declared maxScore.
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(140);
    expect(result.confidence).toBeGreaterThan(0);
  });
});
