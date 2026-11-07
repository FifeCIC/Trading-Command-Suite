/**
 * entry-marker.spec.ts — a short entry must render, with the CORRECT sign (#1231).
 *
 * ⚠️ THE MEASURED DEFECT. The chart overlay was built with `if (signal === 'BUY' || signal ===
 * 'STRONG_BUY')` and a P&L of `(future - current) / current` — a long predicate and a long return.
 * A `SHORT_ONLY` protocol classifies `SELL`/`STRONG_SELL`, so the branch never fired: 12 of 236
 * stored runs rendered a chart with **no entries at all** while their stats said the run had traded.
 *
 * ⚠️ AND THE OBVIOUS FIX IS WORSE THAN THE BUG. Widening the predicate alone draws markers whose
 * P&L has the wrong sign — a short that profited would read negative. Both halves are pinned here.
 */
import { classifyEntrySide, entryPnlPct } from './backtest.service';

describe('classifyEntrySide', () => {
  it('maps both long signal classes to long', () => {
    expect(classifyEntrySide('BUY')).toBe('long');
    expect(classifyEntrySide('STRONG_BUY')).toBe('long');
  });

  it('maps both short signal classes to short', () => {
    expect(classifyEntrySide('SELL')).toBe('short');
    expect(classifyEntrySide('STRONG_SELL')).toBe('short');
  });

  it('returns null for a signal that takes no position', () => {
    for (const s of ['HOLD', 'NEUTRAL', '', 'buy', 'strong_sell']) {
      expect(classifyEntrySide(s)).toBeNull();
    }
  });
});

describe('entryPnlPct — the sign follows the side', () => {
  // ⚠️ THE ACCEPTANCE CASE, BOTH DIRECTIONS: a 1% move must read +1 for whichever side was right.
  it('a long entry followed by a 1% RISE reads +1', () => {
    expect(entryPnlPct('long', 100, 101)).toBe(1);
  });

  it('a short entry followed by a 1% FALL reads +1, not -1', () => {
    expect(entryPnlPct('short', 100, 99)).toBe(1);
  });

  it('a long entry followed by a 1% fall reads -1', () => {
    expect(entryPnlPct('long', 100, 99)).toBe(-1);
  });

  it('a short entry followed by a 1% rise reads -1', () => {
    expect(entryPnlPct('short', 100, 101)).toBe(-1);
  });

  it('the two sides are exact negations of each other', () => {
    for (const future of [90, 99.5, 100.01, 150]) {
      const long = entryPnlPct('long', 100, future);
      const short = entryPnlPct('short', 100, future);
      expect(long).toBe(-(short as number));
    }
  });

  // ⚠️ BYTE-IDENTICAL TO THE OLD LONG PATH. The old expression was
  // `future10 ? Number(((future - current) / current * 100).toFixed(2)) : undefined`, and the 224
  // stored long runs must not shift, so the missing-value and rounding behaviour is pinned here.
  it('preserves the old long rounding exactly', () => {
    expect(entryPnlPct('long', 3, 3.3333333)).toBe(11.11);
    expect(entryPnlPct('long', 100, 100)).toBe(0);
  });

  it('no future bar means undefined, NOT 0 — an absent observation is not a flat trade', () => {
    expect(entryPnlPct('long', 100, undefined)).toBeUndefined();
    expect(entryPnlPct('short', 100, null)).toBeUndefined();
    // the old code treated a 0 price as missing (`future10 ?`), and does so still
    expect(entryPnlPct('long', 100, 0)).toBeUndefined();
  });

  it('a non-numeric or zero current price is undefined, never Infinity', () => {
    expect(entryPnlPct('long', 0, 101)).toBeUndefined();
    expect(entryPnlPct('short', Number.NaN, 101)).toBeUndefined();
    expect(entryPnlPct('long', 100, 'nonsense' as unknown as string)).toBeUndefined();
  });

  it('accepts a numeric string, because MySQL DECIMAL arrives that way', () => {
    expect(entryPnlPct('long', 100, '101')).toBe(1);
  });
});
