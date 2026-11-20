/**
 * exit-guardian core — specs.
 *
 * ⚠️ THESE TWO DECISIONS EXISTED TWICE EACH BEFORE 2026-11-20. The cases below are the branches the
 * live guardian and the backtest both rely on, written once so the two cannot disagree.
 */
import { protectiveStopPrice, protectiveStopHit } from './protective-stop';
import { moneyTargetVerdict } from './money-target';

describe('protectiveStopPrice', () => {
  it('sits slPct BELOW entry for a buy and ABOVE for a sell', () => {
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100, slPct: 1 })).toBeCloseTo(99, 5);
    expect(protectiveStopPrice({ side: 'sell', entryPrice: 100, slPct: 1 })).toBeCloseTo(101, 5);
  });

  it('rounds to the guardian’s 5 decimals, because that is the price it sends', () => {
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 0.4613, slPct: 2.5 })).toBe(0.44977);
  });

  it('▶ CANARY — `slPct: 0` falls back to 1%, which is what the LIVE guardian does (`Number(x ?? 1) || 1`)', () => {
    // ⚠️ AND THIS IS A SEMANTIC COLLISION WORTH KNOWING: the BACKTEST reads `slPct > 0` as "bracket on",
    // so 0 there means NO BRACKET AT ALL, while here it means 1%. Same column, two meanings. The engine's
    // reading is kept because changing it would alter every stored run; this one is kept because it is
    // what is live. Recorded in register row 238 and asserted from both sides.
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100, slPct: 0 })).toBeCloseTo(99, 5);
  });

  it('▶ CANARY — a NEGATIVE slPct is REFUSED, where live would compute a stop above entry', () => {
    // Live: `100 * (1 - (-1)/100)` = 101 — a stop ABOVE the entry of a buy, which the broker either
    // rejects or fills immediately. There is no defensible reading of it, so this core fails closed
    // rather than reproducing a live bug. That difference is deliberate and stated.
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100, slPct: -1 })).toBeNull();
  });

  it('▶ CANARY — an unusable ENTRY returns NULL, never a stop at the entry price', () => {
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 0, slPct: 1 })).toBeNull();
    expect(protectiveStopPrice({ side: 'buy', entryPrice: -5, slPct: 1 })).toBeNull();
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100, slPct: 100 })).toBeNull(); // would be 0
  });

  it('defaults to 1% when the bot leaves slPct unset — the same default the guardian uses', () => {
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100 })).toBeCloseTo(99, 5);
    expect(protectiveStopPrice({ side: 'buy', entryPrice: 100, slPct: null })).toBeCloseTo(99, 5);
  });
});

describe('protectiveStopHit', () => {
  it('a buy is stopped on the bar low at or below the stop', () => {
    expect(protectiveStopHit({ side: 'buy', stopPrice: 99, adverseExtreme: 99 })).toBe(true);
    expect(protectiveStopHit({ side: 'buy', stopPrice: 99, adverseExtreme: 98.99 })).toBe(true);
    expect(protectiveStopHit({ side: 'buy', stopPrice: 99, adverseExtreme: 99.01 })).toBe(false);
  });

  it('a sell is stopped on the bar high at or above the stop — the exact mirror', () => {
    expect(protectiveStopHit({ side: 'sell', stopPrice: 101, adverseExtreme: 101 })).toBe(true);
    expect(protectiveStopHit({ side: 'sell', stopPrice: 101, adverseExtreme: 100.99 })).toBe(false);
  });

  it('▶ CANARY — unreadable prices are NOT a hit, in either direction', () => {
    expect(protectiveStopHit({ side: 'buy', stopPrice: NaN, adverseExtreme: 1 })).toBe(false);
    expect(protectiveStopHit({ side: 'buy', stopPrice: 99, adverseExtreme: NaN })).toBe(false);
  });
});

describe('moneyTargetVerdict', () => {
  it('an unset target is NOT CONFIGURED, not "close at breakeven"', () => {
    expect(moneyTargetVerdict({ targetAmount: null, pnl: 100 })).toEqual({
      configured: false, reached: false, reason: 'not-configured',
    });
    expect(moneyTargetVerdict({ targetAmount: 0, pnl: 100 }).configured).toBe(false);
  });

  it('an unreadable P&L refuses — never treated as zero, never as a win', () => {
    expect(moneyTargetVerdict({ targetAmount: 5, pnl: null }).reason).toBe('pnl-unreadable');
    expect(moneyTargetVerdict({ targetAmount: 5, pnl: NaN }).reason).toBe('pnl-unreadable');
  });

  it('reaches at the target and above it, exactly', () => {
    expect(moneyTargetVerdict({ targetAmount: 5, pnl: 5 }).reached).toBe(true);
    expect(moneyTargetVerdict({ targetAmount: 5, pnl: 4.99 }).reached).toBe(false);
    expect(moneyTargetVerdict({ targetAmount: 5, pnl: 4.99 }).reason).toBe('below-target');
  });

  it('a negative P&L is below target, not a missing reading', () => {
    const v = moneyTargetVerdict({ targetAmount: 5, pnl: -20 });
    expect(v).toEqual({ configured: true, reached: false, reason: 'below-target' });
  });
});
