/**
 * peak-change.spec.ts — pins the "highest % change reached on the day" convention.
 *
 * These cases guard the three decisions that would otherwise drift silently: the denominator is the
 * previous session's close, "reached" is the HIGH (not the closing bar), and an unmeasurable day is
 * null-with-a-reason rather than a flat 0%.
 */
import { peakChangeOnDay } from './peak-change';

describe('peakChangeOnDay', () => {
  it('winners: measures the highest HIGH, not the last close', () => {
    // Opened near 100, spiked to 134 (+34%), finished back at 110 (+10%).
    const bars = [
      { high: 101, low: 99, close: 100 },
      { high: 134, low: 110, close: 120 },
      { high: 110, low: 105, close: 110 },
    ];
    const r = peakChangeOnDay(bars, 100, 'winners');
    expect(r.peakPct).toBeCloseTo(34, 6);
    expect(r.peakPrice).toBe(134);
  });

  it('losers: measures the lowest LOW (the deepest drop), not the high', () => {
    // Opened near 100 and collapsed to 8 (−92%), finishing at 11 (−89%).
    const bars = [
      { high: 100, low: 80, close: 90 },
      { high: 30, low: 8, close: 11 },
    ];
    const r = peakChangeOnDay(bars, 100, 'losers');
    expect(r.peakPct).toBeCloseTo(-92, 6);
    expect(r.peakPrice).toBe(8);
  });

  it('falls back to close when a bar has no usable high/low', () => {
    expect(peakChangeOnDay([{ high: null, close: 125 }], 100, 'winners').peakPct).toBeCloseTo(25, 6);
    expect(peakChangeOnDay([{ low: null, close: 75 }], 100, 'losers').peakPct).toBeCloseTo(-25, 6);
  });

  it('is null with a reason when there is no previous close', () => {
    const r = peakChangeOnDay([{ high: 120, close: 118 }], null, 'winners');
    expect(r.peakPct).toBeNull();
    expect(r.reason).toBeTruthy();
  });

  it('is null with a reason when the day has no usable bar', () => {
    const r = peakChangeOnDay([], 100, 'winners');
    expect(r.peakPct).toBeNull();
    expect(r.reason).toBeTruthy();
  });
});
