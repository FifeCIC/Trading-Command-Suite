import { VolumeConfirmationDirective } from './volume-confirmation.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBars(volumes: number[], basePrice = 100): MarketBar[] {
  return volumes.map((volume, i) => ({
    timestamp: new Date(Date.now() - (volumes.length - i) * 3600000),
    open: basePrice,
    high: basePrice * 1.005,
    low: basePrice * 0.995,
    close: basePrice,
    volume,
  }));
}

describe('VolumeConfirmationDirective', () => {
  const directive = new VolumeConfirmationDirective();

  it('returns score 0 with insufficient data', () => {
    const result = directive.calculate({ symbol: 'TEST', bars: makeBars([1000, 2000]) });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('scores high with volume surge (2x+ average)', () => {
    // 20 bars of normal volume then a surge
    const normal = Array.from({ length: 20 }, () => 1000000);
    const surge = [2500000]; // 2.5x
    const bars = makeBars([...normal, ...surge]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(80);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.reason).toContain('surge');
  });

  it('scores moderate with above-average volume (1.3-2x)', () => {
    const normal = Array.from({ length: 20 }, () => 1000000);
    const above = [1500000]; // 1.5x
    const bars = makeBars([...normal, ...above]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(85);
  });

  it('scores low with below-average volume', () => {
    const normal = Array.from({ length: 20 }, () => 1000000);
    const low = [400000]; // 0.4x
    const bars = makeBars([...normal, ...low]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThan(30);
    expect(result.reason).toContain('Below-average');
  });

  it('handles zero average volume', () => {
    const zeros = Array.from({ length: 21 }, () => 0);
    const bars = makeBars(zeros);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.reason).toContain('zero');
  });
});
