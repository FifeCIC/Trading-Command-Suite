import { HurstMemoryDirective } from './hurst-memory.directive';
import { MarketBar } from '../interfaces/directive.interface';

function makeBar(close: number, high: number, low: number, i = 0): MarketBar {
  return { timestamp: new Date(Date.now() - i * 3600000), open: close, high, low, close, volume: 1000000 };
}

describe('HurstMemoryDirective', () => {
  const directive = new HurstMemoryDirective();

  it('should return score=0 with insufficient data', () => {
    const bars = Array(10).fill(null).map((_, i) => makeBar(100, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0.1);
  });

  it('should produce a valid Hurst estimate with sufficient data', () => {
    const bars: MarketBar[] = [];
    for (let i = 0; i < 50; i++) {
      bars.push(makeBar(100 + i * 0.2, 101 + i * 0.2, 99 + i * 0.2, 50 - i));
    }
    const result = directive.calculate({ symbol: 'TEST', bars });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  /**
   * Regression for the 2026-11-25 finding: confidence was computed from the PRICE series
   * (`1 − ΣΔ²/Σ(x−x̄)²`), not from the log-log regression that produced H. On a trending series that
   * expression saturates at its 0.95 clamp — measured at 0.87 on 8 of 9 committed fixtures, i.e. a
   * constant — and its one low reading was this maximally anti-persistent sawtooth at **0.36**. So
   * the weighting penalised H exactly where H was most decisive, and boosted it everywhere else.
   */
  it('weights confidence by the log-log fit, not by price volatility', () => {
    // A pure sawtooth: R/S is identical at every window, so log(R/S) is flat and H pins at its 0.1
    // floor. The regression is exact, so this must NOT be the directive's lowest-confidence reading.
    const bars = Array.from({ length: 200 }, (_, i) => makeBar(100 + (i % 2), 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });

    expect(result.reason).toContain('H=0.100');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  /**
   * Two R/S windows are collinear by construction, so an R² of 1 there is arithmetic rather than
   * evidence. The estimate stays at a NEUTRAL confidence and the reason says the fit could not be
   * measured — flooring it at 0.3 would cross `scoring.service`'s 0.5 low-confidence suppression
   * and silently drop the directive's vote on 50–63-bar series.
   */
  it('leaves confidence neutral and says so when the fit cannot be measured', () => {
    const bars = Array.from({ length: 55 }, (_, i) => makeBar(100 + i * 0.2, 101, 99, i));
    const result = directive.calculate({ symbol: 'TEST', bars });

    expect(result.confidence).toBe(0.6);
    expect(result.reason).toContain('Fit quality unmeasurable on 2 R/S windows');
  });
});
