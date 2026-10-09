import { ATRTrailingStopDirective } from './mt5-indicators.directives';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * atr-trailing-stop.directive.spec.ts — the #1075 replacement (owner ruling "B", 2026-10-09).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The directive graded the gap between price and each trailing stop as a FRACTION OF PRICE
 * (0.03 / 0.1 = 3% / 10%). That was unreachable by construction: `close ≤ hh20` means the
 * bullish gap can never exceed `3×ATR/close`, so firing required **ATR > 1% of price** while
 * real 5m ATR is 0.02–0.07% — the directive contributed directional evidence **0 times** in
 * every measured window. The replacement expresses the SAME gaps in ATR units.
 *
 * ⚠️ THE FIRST TEST IS THE POINT: on an ordinary trending series the OLD code returned
 * `neutral 30` ("inside the channel") — the fix must return a directional reading. Restoring
 * the fraction thresholds fails this suite (canaried — see the handoff).
 */

/** Same shape the stop-directives mirror suite uses — one bar per hourly step. */
function trendBars(start: number, step: number, n: number): MarketBar[] {
  const bars: MarketBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + step * i;
    bars.push({
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600_000),
      open: c - step * 0.8,
      high: c + step * 0.2,
      low: c - step * 1.2,
      close: c,
      volume: 1_000_000,
    });
  }
  return bars;
}

/**
 * A wide range built INSIDE the 20-bar window, followed by a quiet middle long enough to
 * pull ATR(14) down: hh/ll sit ~5 points either side of the closes while recent ATR is ~0.2 —
 * the one geometry where BOTH gaps are inside the ±0.5×ATR dead band (a genuine "no clear
 * trend"). ⚠️ The extremes must sit within the LAST 20 bars or they leave the window entirely
 * (the first draft of this helper got exactly that wrong — the settle then sat 20+ ATR above
 * the windowed high and read STRONG bullish).
 */
function settledRangeBars(): MarketBar[] {
  const bars: MarketBar[] = [];
  const push = (high: number, low: number, close: number) =>
    bars.push({
      timestamp: new Date(Date.UTC(2026, 0, 1) + bars.length * 3600_000),
      open: close,
      high,
      low,
      close,
      volume: 1,
    });

  for (let i = 0; i < 10; i++) push(100.4, 99.6, 100); // pre-history — drops out of the window
  push(101.4, 100.4, 101); // idx 10
  push(103.4, 101.4, 103); // idx 11
  push(105.5, 103.4, 105); // idx 12 — the high, INSIDE the window
  push(105.0, 103.8, 104); // idx 13
  push(104.5, 93.5, 95); // idx 14 — the low, INSIDE the window (excluded from the ATR window)
  push(96.2, 94.6, 95.5); // idx 15 — also outside the last-14 ATR window
  for (let i = 0; i < 14; i++) push(100.1, 99.9, 100); // idx 16–29 — the settle (ATR ≈ 0.2)
  return bars;
}

/**
 * Both stops graded (bands overlap). hh=105.5 (idx12) and ll=93.5 (idx14) sit inside the
 * window; the settle's own bars carry TR=4 ⇒ ATR(14)=4 ⇒ 3×ATR=12, so the gaps are
 * `3 − (hh−close)/4` and `3 − (close−ll)/4` — the settle close steers which side wins.
 */
function overlapBars(settleClose: number): MarketBar[] {
  const bars: MarketBar[] = [];
  const push = (high: number, low: number, close: number) =>
    bars.push({
      timestamp: new Date(Date.UTC(2026, 0, 1) + bars.length * 3600_000),
      open: close,
      high,
      low,
      close,
      volume: 1,
    });

  for (let i = 0; i < 10; i++) push(100.4, 99.6, 100); // pre-history
  push(101.4, 100.4, 101); // idx 10
  push(103.4, 101.4, 103); // idx 11
  push(105.5, 103.4, 105); // idx 12 — the high
  push(105.0, 103.8, 104); // idx 13
  push(104.5, 93.5, 95); // idx 14 — the low
  push(96.2, 94.6, 95.5); // idx 15 — outside the last-14 ATR window
  for (let i = 0; i < 14; i++) push(101.5, 97.5, settleClose); // idx 16–29 — TR=4 ⇒ ATR=4
  return bars;
}

describe('ATRTrailingStopDirective — ATR-unit gaps (#1075)', () => {
  it('THE FIX: an ordinary uptrend now speaks (the old fraction thresholds returned neutral)', () => {
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    expect(r.signalClass).toBe('bullish');
    // close makes a new high ⇒ gap → 3×ATR above the long stop ⇒ strong grade.
    expect(r.score).toBe(75);
    expect(r.reason).toContain('×ATR');
  });

  it('a mirrored downtrend is bearish at equal magnitude', () => {
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: trendBars(200, -2, 40) });
    expect(r.signalClass).toBe('bearish');
    expect(r.score).toBe(75);
  });

  it('a wide range with a quiet middle is neutral — and the reason names both gaps in ATR units', () => {
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: settledRangeBars() });
    expect(r.signalClass).toBe('neutral');
    expect(r.score).toBe(30);
    expect(r.reason).toContain('inside ATR trailing-stop channel');
    expect(r.reason).toContain('×ATR');
  });

  it('too few bars is neutral and named', () => {
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: trendBars(100, 2, 10) });
    expect(r.signalClass).toBe('neutral');
    expect(r.score).toBe(0);
    expect(r.reason).toContain('Need 25 bars');
  });

  it('OVERLAP TIE: equal gaps resolve to the long side (moderate bullish) and the reason says so', () => {
    // hh−close = close−ll = 6 ⇒ both gaps = 1.5×ATR ⇒ tie ⇒ long wins.
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: overlapBars(99.5) });
    expect(r.signalClass).toBe('bullish');
    expect(r.score).toBe(60);
    expect(r.reason).toContain('overlap');
  });

  it('OVERLAP PICK: the LARGER gap wins — a lower close hands it to the short side', () => {
    // close 99 ⇒ longGap 1.375 vs short 1.625 ⇒ bearish, still moderate.
    const r = new ATRTrailingStopDirective().calculate({ symbol: 'X', bars: overlapBars(99) });
    expect(r.signalClass).toBe('bearish');
    expect(r.score).toBe(60);
    expect(r.reason).toContain('overlap');
  });

  it('is deterministic', () => {
    const d = new ATRTrailingStopDirective();
    const a = d.calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    const b = d.calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    expect(a.signalClass).toBe(b.signalClass);
    expect(a.score).toBe(b.score);
    expect(a.reason).toBe(b.reason);
  });
});
