/**
 * multi-timeframe-trend — a claim of "alignment" is only allowed when the alignment test RAN.
 * =============================================================================================
 * Created 2026-11-02 after measuring the defect this file now locks:
 *
 *   At the previous `minBars` of 20, `loadHigherTfBundle()` supplied 30 daily / 20 hourly / 20
 *   fifteen-minute bars for `btc-scalp-v1-long`. `ema()` returns nulls throughout when given fewer bars
 *   than its period, so EMA50 — the thing that DEFINES alignment — was null on all three timeframes.
 *   Both `bullishEma` and `bearishEma` were therefore false, every timeframe fell through to the
 *   `!aboveVwap && !aboveEma50` branch ("price below the mean"), the directive reported
 *   **"Perfect bearish — all timeframes aligned down"** and scored its maximum **120**.
 *
 * Reproduced independently from the bar store: 30/20/20 bars → 120; 50/50/50 → 120 (earned);
 * 200/200/200 → 80. The verdict was a function of how many bars the caller happened to load.
 *
 * ⚠️ CANARY BOTH DIRECTIONS. Remove the `ema50Last == null` guard and the first test fails (it scores
 * 120 from bars that cannot support the test). Restore it and the second passes (a real alignment
 * still scores). A guard observed only in the passing direction proves nothing.
 */
import { MultiTimeframeTrendDirective } from './multi-timeframe-trend.directive';
import type { DirectiveInput, MarketBar } from '../interfaces/directive.interface';

/** A steadily falling series — EMA9 < EMA21 < EMA50, price below every average. */
function fallingBars(n: number): MarketBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 1000 - i * 2;
    return {
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      open: close + 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000,
    };
  });
}

/** A steadily rising series — the mirror, for the bullish branch. */
function risingBars(n: number): MarketBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 1000 + i * 2;
    return {
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000,
    };
  });
}

const input = (day: MarketBar[], hour: MarketBar[], m15: MarketBar[]): DirectiveInput =>
  ({ symbol: 'TEST', dayBars: day, hourBars: hour, min15Bars: m15, bars: m15 } as unknown as DirectiveInput);

describe('multi-timeframe-trend — declares what its trend test needs', () => {
  const d = new MultiTimeframeTrendDirective();

  it('declares minBars 50 per timeframe (EMA50 is the binding requirement, not 20)', () => {
    expect(d.minBars).toEqual({ '1d': 50, '1h': 50, '15m': 50 });
  });

  it('REFUSES to claim alignment when the EMA(50) test cannot run', () => {
    // 30/20/20 is exactly what the bundle supplied before the fix — and it scored 120.
    const res = d.calculate(input(fallingBars(30), fallingBars(20), fallingBars(20)));

    expect(res.score).toBe(0);
    expect(res.signalClass).toBe('neutral');
    // The reason must say WHY. "N/A" with no cause is the same defect one layer down, and a
    // "need dayBars/hourBars" message when bars WERE supplied sends the reader to the wrong place.
    expect(res.reason).toMatch(/needs 50 bars per timeframe/);
    expect(res.reason).toMatch(/1D: only 30 bars/);
    expect(res.reason).toMatch(/1H: only 20 bars/);
    expect(res.reason).not.toMatch(/aligned down/);
  });

  it('still reports a real alignment once every timeframe has 50 bars', () => {
    const res = d.calculate(input(fallingBars(60), fallingBars(60), fallingBars(60)));
    expect(res.score).toBeGreaterThan(0);
    expect(res.signalClass).toBe('bearish');
  });

  it('reports the mirror on rising bars (the guard does not block the bullish branch)', () => {
    const res = d.calculate(input(risingBars(60), risingBars(60), risingBars(60)));
    expect(res.score).toBeGreaterThan(0);
    expect(res.signalClass).toBe('bullish');
  });

  it('names the CAUSE per timeframe when only one is missing', () => {
    const res = d.calculate(input(fallingBars(60), fallingBars(60), []));
    // One timeframe absent must not zero the directive, and must be named.
    expect(res.reason).toMatch(/15M: N\/A \(15M: no bars supplied\)/);
    expect(res.score).toBeGreaterThan(0);
  });
});
