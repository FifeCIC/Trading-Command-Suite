import { AtrDipDirective } from './atr-dip.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('AtrDipDirective', () => {
  const directive = new AtrDipDirective();

  it('should return score=0, confidence=0.1 with insufficient data', () => {
    const bars: MarketBar[] = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain('Insufficient data');
  });

  it('should produce high score for a quality dip in the 1-2 ATR sweet spot', () => {
    // ATR_PERIOD=14, LOOKBACK_HIGH=20, MIN_BARS=34
    // Build 34 bars with ATR ~2, then current price dipped ~1.3 ATR below lookback high
    const bars: MarketBar[] = [];
    // 34 bars: stable at 100, range of 2 (high=101, low=99), ATR converges to ~2
    for (let i = 0; i < 34; i++) {
      bars.push(makeBar(100, 101, 99, 34 - i));
    }
    // Override the last 20 bars to have a high at 105 somewhere in the lookback
    bars[20] = makeBar(104, 105, 103, 14);
    // Current price at ~102.4 → dip = 105 - 102.4 = 2.6, ATR ~2, dipInAtrs ~1.3
    bars[bars.length - 1] = makeBar(102.4, 103, 102, 0);

    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThan(50);
    expect(result.confidence).toBe(0.7);
  });

  it('should produce score=15 when price is at or above the recent high', () => {
    // All bars at a flat price = current price equals the high in lookback
    const bars: MarketBar[] = [];
    for (let i = 0; i < 34; i++) {
      bars.push(makeBar(100, 100, 99, 34 - i));
    }
    // Current bar's close equals lookback high
    bars[bars.length - 1] = makeBar(100, 100, 99, 0);
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThanOrEqual(15);
    expect(result.reason).toContain('No dip');
  });

  it('should produce very low score for a deep drop (>3 ATR breakdown)', () => {
    // Stable bars at 100 with ATR ~2, then crash to 90 = dip of ~10/2 = 5 ATR
    const bars: MarketBar[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push(makeBar(100, 101, 99, 34 - i));
    }
    // Keep high in lookback at 101
    // Crash the last 4 bars
    bars.push(makeBar(95, 96, 94, 4));
    bars.push(makeBar(92, 93, 91, 3));
    bars.push(makeBar(90, 91, 89, 2));
    bars.push(makeBar(88, 89, 87, 1));

    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeLessThanOrEqual(10);
    // Hybrid v2.0.1 reason format: "Dip: {n} ATR from high {h}. base=...". The old
    // "Deep drop" phrase was removed — assert the new prefix (atr-dip.directive.ts).
    expect(result.reason).toContain('Dip:');
  });
});
