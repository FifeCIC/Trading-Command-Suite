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
    // 21 bars used to be enough; the comparison now needs 22 (last complete + 20 before it).
    const result = directive.calculate({ symbol: 'TEST', bars: makeBars(Array.from({ length: 21 }, () => 1000)) });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('scores high with volume surge (2x+ average)', () => {
    // ⚠️ Every fixture ends with an IN-PROGRESS bar that must never be read (#1130). The bar under
    // test is the second-to-last: the last COMPLETE bar.
    const normal = Array.from({ length: 20 }, () => 1000000);
    const bars = makeBars([...normal, 2500000, 1000]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(80);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.reason).toContain('surge');
  });

  it('scores moderate with above-average volume (1.3-2x)', () => {
    const normal = Array.from({ length: 20 }, () => 1000000);
    const bars = makeBars([...normal, 1500000, 1000]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(85);
  });

  it('scores low with below-average volume', () => {
    const normal = Array.from({ length: 20 }, () => 1000000);
    const bars = makeBars([...normal, 400000, 1000]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThan(30);
    expect(result.reason).toContain('Below-average');
  });

  it('handles zero average volume', () => {
    const bars = makeBars(Array.from({ length: 22 }, () => 0));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.reason).toContain('zero');
  });

  // ⚠️ CANARY — this is the #1130 defect, and it FAILS on the old implementation.
  //
  // 20 complete bars at 1,000,000, then a complete bar at 1,000,000 (ratio 1.0 → "Normal"), then an
  // in-progress bar holding 1,000 — what a bar looks like a few minutes into its period.
  //
  // OLD: numerator = the in-progress bar → 0.001x → score ~0, "Below-average".
  // NEW: numerator = the last COMPLETE bar → 1.0x → "Normal volume".
  it('CANARY — an in-progress bar must not be read as the current volume', () => {
    const normal = Array.from({ length: 20 }, () => 1000000);
    const bars = makeBars([...normal, 1000000, 1000]);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(25);
    expect(result.reason).toContain('Normal volume');
    expect(result.reason).not.toContain('Below-average');
  });

  it('CANARY — the reading cannot be moved by the in-progress bar', () => {
    // Same 20-bar history and same last complete bar, two very different in-progress values:
    // the result must be identical, or the partial bar is still leaking into the ratio.
    const normal = Array.from({ length: 20 }, () => 1000000);
    const a = directive.calculate({ symbol: 'TEST', bars: makeBars([...normal, 1000000, 1]) });
    const b = directive.calculate({ symbol: 'TEST', bars: makeBars([...normal, 1000000, 999999]) });
    expect(a.score).toBe(b.score);
    expect(a.reason).toBe(b.reason);
  });
});
