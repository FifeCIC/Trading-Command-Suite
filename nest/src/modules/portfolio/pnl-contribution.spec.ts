/**
 * pnl-contribution.spec.ts — the metals split must not be able to flatter the account.
 *
 * ⚠️ THE CASE THAT MATTERS IS THE TAG SPELLING. Measured 2026-11-27: `symbol.tags` holds `"metal"` on
 * XAUUSD and `"metals"` on XAGUSD. A strict single-spelling match would have classified GOLD as a
 * non-metal — putting the instrument that dominates the account into the "everything else" figure, which
 * is the one direction that makes a losing month look like a broad turnaround.
 */
import { isMetalTagged, summariseInstrument, summariseSplit } from './pnl-contribution.service';

describe('isMetalTagged', () => {
  it('accepts the plural tag the table actually carries', () => {
    expect(isMetalTagged(['speed-trading', 'metals', 'commodity'])).toBe(true);
  });

  it('▶ accepts the SINGULAR as well — XAUUSD carries "metal" while XAGUSD carries "metals"', () => {
    expect(isMetalTagged(['speed-trading', 'xtrend', 'metal'])).toBe(true);
  });

  it('is case- and whitespace-insensitive, because a tag is data', () => {
    expect(isMetalTagged([' Metals '])).toBe(true);
    expect(isMetalTagged(['METAL'])).toBe(true);
  });

  it('does NOT match a tag that merely contains the word', () => {
    // A substring match would classify "metal-detector" or "nonmetal" as metal.
    expect(isMetalTagged(['nonmetal'])).toBe(false);
    expect(isMetalTagged(['metal-detector'])).toBe(false);
  });

  it('is false for no tags, a non-array, or an unrelated list', () => {
    expect(isMetalTagged(null)).toBe(false);
    expect(isMetalTagged(undefined)).toBe(false);
    expect(isMetalTagged('metals')).toBe(false);
    expect(isMetalTagged(['forex', 'commodity'])).toBe(false);
  });
});

describe('summariseInstrument', () => {
  it('separates gross win from gross loss, so a churn is visible as a churn', () => {
    // The measured gold month: +649.17 of wins against -649.92 of losses, ending flat.
    const row = summariseInstrument('XAUUSD', [649.17, -649.92], true);
    expect(row.trades).toBe(2);
    expect(row.wins).toBe(1);
    expect(row.losses).toBe(1);
    expect(row.grossWin).toBeCloseTo(649.17, 2);
    expect(row.grossLoss).toBeCloseTo(649.92, 2);
    expect(row.net).toBeCloseTo(-0.75, 2);
  });

  it('a flat instrument is not a zero-trade instrument', () => {
    expect(summariseInstrument('A', [5, -5], false).winRate).toBe(50);
    expect(summariseInstrument('B', [], false).winRate).toBeNull();
  });

  it('counts a break-even trade as neither a win nor a loss', () => {
    const row = summariseInstrument('C', [0, 10], false);
    expect(row.wins).toBe(1);
    expect(row.losses).toBe(0);
    expect(row.trades).toBe(2);
  });
});

describe('summariseSplit', () => {
  it('sums a population', () => {
    const rows = [summariseInstrument('A', [10, -4], false), summariseInstrument('B', [6], true)];
    const s = summariseSplit(rows);
    expect(s).toEqual({ trades: 3, net: 12, grossWin: 16, grossLoss: 4 });
  });

  it('▶ an EMPTY population is null, not a zero — "nothing left" is not "broke even"', () => {
    expect(summariseSplit([])).toBeNull();
    expect(summariseSplit([summariseInstrument('A', [], true)])).toBeNull();
  });

  it('▶ CANARY — a population that genuinely nets to zero is NOT null, so the two states differ', () => {
    const s = summariseSplit([summariseInstrument('A', [5, -5], true)]);
    expect(s).not.toBeNull();
    expect(s?.net).toBe(0);
  });
});

describe('the measured week, recomputed from its rows', () => {
  it('gold alone decides the sign — the finding this endpoint exists to surface', () => {
    // Week from 2026-11-23: gold +256.39 on 14 trades, everything else -113.86.
    const gold = summariseInstrument('XAUUSD', [99.76, -30.07, 50, 40, 30, 20, 10, 10, 8, 5, 4, 3, 2, 4.7], true);
    const others = [
      summariseInstrument('GER40', [13.33], false),
      summariseInstrument('US500', [11.99], false),
      summariseInstrument('NZDJPY', [-139.18], false),
    ];
    const all = summariseSplit([gold, ...others]);
    const ex = summariseSplit(others);
    expect(all!.net).toBeGreaterThan(0);
    expect(ex!.net).toBeLessThan(0);
    // The whole point: the headline is positive, the ex-metal line is not.
    expect(Math.sign(all!.net)).not.toBe(Math.sign(ex!.net));
  });
});
