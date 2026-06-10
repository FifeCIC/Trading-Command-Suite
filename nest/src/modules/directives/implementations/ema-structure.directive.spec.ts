import { EmaStructureDirective } from './ema-structure.directive';
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

describe('EmaStructureDirective', () => {
  const directive = new EmaStructureDirective();

  it('returns score 0 with insufficient data', () => {
    const result = directive.calculate({ symbol: 'TEST', bars: makeBars([100, 101, 102]) });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('scores high with full alignment (price > EMA20 > EMA50)', () => {
    // Steady uptrend ensures price > EMA20 > EMA50
    const bars = makeBars(Array.from({ length: 60 }, (_, i) => 100 + i * 0.8));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(60);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.reason).toContain('Full alignment');
  });

  it('scores low with no alignment (downtrend)', () => {
    // Steady downtrend — price below both EMAs
    const bars = makeBars(Array.from({ length: 60 }, (_, i) => 200 - i * 1.2));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThan(30);
  });

  it('gives partial score when price above EMA20 but EMA20 below EMA50', () => {
    // Start high, drop, then recover above short-term but not long-term
    const phase1 = Array.from({ length: 35 }, (_, i) => 150 - i * 1.5); // decline
    const phase2 = Array.from({ length: 20 }, (_, i) => 97 + i * 0.8); // partial recovery
    const bars = makeBars([...phase1, ...phase2]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThanOrEqual(50);
  });
});
