import { SuperTrendDirective } from './mt5-indicators.directives';
import { computeSuperTrend } from '../utils/supertrend';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * supertrend.directive.spec.ts — the #1077 replacement (owner ruling "B", 2026-10-09).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The directive used to build its bands from the LAST BAR's own high/low: ±55 was decided by a
 * fraction of a pip and the `score 75` branches were unreachable by construction. The replacement
 * computes a canonical ratcheting SuperTrend; these tests pin the SEMANTICS the owner authorised,
 * and the discriminating cases are chosen to FAIL if anyone restores the one-bar formula or
 * disables the ratchet (canaried both directions — see the two mutations in the handoff).
 *
 * ⚠️ THE PULLBACK CASE IS THE POINT. A rising market with one red bar that closes below its own
 * midpoint made the OLD code say `bearish` — trend information discarded in favour of one bar's
 * geometry. The canonical computation keeps the trend until price closes through the Ratified
 * trailing line. That difference is the fix, so it is the first test.
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

function appendBar(bars: MarketBar[], high: number, low: number, close: number): MarketBar[] {
  const i = bars.length;
  return [
    ...bars,
    { timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600_000), open: close, high, low, close, volume: 1_000_000 },
  ];
}

describe('SuperTrendDirective — canonical ratchet (#1077)', () => {
  it('THE FIX: a red pullback bar inside an uptrend stays BULLISH (the old formula said bearish)', () => {
    // 30 rising bars (100 → 158), then one bar whose close (154.9) sits BELOW its own midpoint
    // (156.0) — the old one-bar test returned `bearish` here; the ratcheted trend line (~148)
    // is untouched by a pullback bar, so the trend is intact.
    const bars = appendBar(trendBars(100, 2, 30), 158.5, 153.5, 154.9);
    const r = new SuperTrendDirective().calculate({ symbol: 'X', bars });
    expect(r.signalClass).toBe('bullish');
    expect(r.score).toBe(55);
  });

  it('a close THROUGH the ratcheted line flips the trend (bearish)', () => {
    // After the same rise, a bar closing at 145 is below the ratified line (~148) — a flip, and the
    // test that fails if the RATCHET is removed (without it, the flip needs to break ~134).
    const bars = appendBar(trendBars(100, 2, 30), 149, 143, 145);
    const r = new SuperTrendDirective().calculate({ symbol: 'X', bars });
    expect(r.signalClass).toBe('bearish');
    expect(r.score).toBe(55);
  });

  it('a hard drop closes through everything — bearish, equal magnitude', () => {
    const bars = appendBar(trendBars(100, 2, 30), 158.5, 138.5, 140);
    const r = new SuperTrendDirective().calculate({ symbol: 'X', bars });
    expect(r.signalClass).toBe('bearish');
    expect(r.score).toBe(55);
  });

  it('a sustained uptrend is bullish and a mirrored downtrend is bearish, at equal magnitude', () => {
    const d = new SuperTrendDirective();
    const up = d.calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    const down = d.calculate({ symbol: 'X', bars: trendBars(200, -2, 40) });
    expect(up.signalClass).toBe('bullish');
    expect(down.signalClass).toBe('bearish');
    expect(up.score).toBe(down.score);
  });

  it('too few bars is neutral and named — never guessed into a direction', () => {
    const r = new SuperTrendDirective().calculate({ symbol: 'X', bars: trendBars(100, 2, 10) });
    expect(r.signalClass).toBe('neutral');
    expect(r.score).toBe(0);
    expect(r.reason).toContain('Need 15 bars');
  });

  it('is deterministic and never throws on a flat series', () => {
    const flat = trendBars(100, 0, 40);
    const d = new SuperTrendDirective();
    expect(() => d.calculate({ symbol: 'X', bars: flat })).not.toThrow();
    const a = d.calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    const b = d.calculate({ symbol: 'X', bars: trendBars(100, 2, 40) });
    expect(a.signalClass).toBe(b.signalClass);
    expect(a.score).toBe(b.score);
  });
});

describe('computeSuperTrend — the util contract', () => {
  it('refuses to judge with fewer bars than one ATR window plus a ratchet step', () => {
    expect(computeSuperTrend([]).direction).toBeNull();
    expect(computeSuperTrend(trendBars(100, 2, 5)).direction).toBeNull();
    expect(computeSuperTrend(trendBars(100, 2, 10)).direction).toBeNull();
  });

  it('a monotone series establishes a direction', () => {
    expect(computeSuperTrend(trendBars(100, 1, 40)).direction).toBe('up');
    expect(computeSuperTrend(trendBars(200, -1, 40)).direction).toBe('down');
  });

  it('exposes the trailing line and ATR for the reason string', () => {
    const r = computeSuperTrend(trendBars(100, 2, 40));
    expect(r.direction).toBe('up');
    expect(r.trendLine).toBeGreaterThan(0);
    expect(r.atr).toBeGreaterThan(0);
  });
});
