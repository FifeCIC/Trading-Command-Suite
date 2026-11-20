/**
 * pyramid-and-atr.spec.ts — the two decisions extracted from the guardian/pyramid services.
 *
 * ⚠️ THE PYRAMID FILTER IS THE POINT. Its two historical defects were silent: `Number(null) === 0`
 * made a position with no magic look like another bot's, and a symbol-only match let Bot B be blocked
 * by Bot A's position on a netting account. Both directions are asserted below.
 */
import { computeAtr, ATR_RANGE_COUNT } from './atr';
import {
  filterOwnPositions,
  pyramidTier,
  pyramidVerdict,
  type PyramidPosition,
} from './pyramid-decision';

const bar = (high: number, low: number, close: number) => ({ high, low, close });

describe('computeAtr', () => {
  it('averages the true range over the first 14 bars, using the higher of range or gap', () => {
    // 15 bars → 14 ranges, each high-low = 2, no gaps → ATR 2.
    const bars = Array.from({ length: 15 }, () => bar(12, 10, 11));
    expect(computeAtr(bars)).toBeCloseTo(2, 10);
  });

  it('a gap up makes the range larger than high-low', () => {
    const bars = [bar(10, 9, 9), bar(20, 19, 19)];
    // range = max(1, |20-9|, |19-9|) = 11
    expect(computeAtr(bars)).toBeCloseTo(11, 10);
  });

  it('▶ CANARY — fewer than two bars returns 0, which a caller must read as "cannot judge"', () => {
    expect(computeAtr([])).toBe(0);
    expect(computeAtr([bar(10, 9, 9)])).toBe(0);
    expect(ATR_RANGE_COUNT).toBe(14);
  });

  it('refuses to average an unreadable bar rather than skipping it', () => {
    expect(computeAtr([bar(10, 9, 9), bar(NaN, 9, 9)])).toBe(0);
  });

  it('uses the FIRST 14 ranges even when handed 30 bars — the existing behaviour, asserted', () => {
    const early = Array.from({ length: 15 }, () => bar(10, 9, 9)); // range 1
    const late = Array.from({ length: 15 }, () => bar(10, 1, 9)); // range 9
    expect(computeAtr([...early, ...late])).toBeCloseTo(1, 10);
  });
});

describe('filterOwnPositions', () => {
  const p = (over: Partial<PyramidPosition> = {}): PyramidPosition => ({
    symbol: 'NXXT', ticket: 1, volume: 0.01, magic: 111, accountId: 'acct-1', ...over,
  });

  it('keeps this bot’s position on this symbol', () => {
    expect(filterOwnPositions({ positions: [p()], symbol: 'nxxT', accountId: 'acct-1', incomingMagic: 111 })).toHaveLength(1);
  });

  it('drops a position on another account', () => {
    expect(filterOwnPositions({ positions: [p({ accountId: 'acct-2' })], symbol: 'NXXT', accountId: 'acct-1' })).toHaveLength(0);
  });

  it('▶ CANARY — a position with NO account id still blocks (unknown is not "elsewhere")', () => {
    expect(filterOwnPositions({ positions: [p({ accountId: null })], symbol: 'NXXT', accountId: 'acct-1' })).toHaveLength(1);
  });

  it('▶ CANARY — on a hedging account another bot’s magic is not ours…', () => {
    const out = filterOwnPositions({
      positions: [p({ magic: 999 })], symbol: 'NXXT', accountId: 'acct-1', positionModel: 'hedging', incomingMagic: 111,
    });
    expect(out).toHaveLength(0);
  });

  it('▶ CANARY — …but a position with NO magic still blocks, because `Number(null)` is 0', () => {
    // The historical defect: 0 is finite and unequal to any real magic, so `unknown` read as `not ours`.
    const out = filterOwnPositions({
      positions: [p({ magic: null })], symbol: 'NXXT', accountId: 'acct-1', positionModel: 'hedging', incomingMagic: 111,
    });
    expect(out).toHaveLength(1);
  });

  it('ignores magic entirely on a netting account', () => {
    const out = filterOwnPositions({
      positions: [p({ magic: 999 })], symbol: 'NXXT', accountId: 'acct-1', positionModel: 'netting', incomingMagic: 111,
    });
    expect(out).toHaveLength(1);
  });
});

describe('pyramidTier / pyramidVerdict', () => {
  const open = (over: Partial<PyramidPosition> = {}): PyramidPosition => ({
    symbol: 'NXXT', volume: 0.01, entryPrice: 10, sl: 10, profit: 5, ...over,
  });

  it('tier is the larger of the position count and volume ÷ baseSize', () => {
    expect(pyramidTier([open()], 0.01)).toBe(1);
    expect(pyramidTier([open({ volume: 0.03 })], 0.01)).toBe(3); // averaged entry
    expect(pyramidTier([open(), open()], 0.01)).toBe(2);
  });

  it('▶ CANARY — maxTiers <= 1 BLOCKS by default and says how to change it', () => {
    const v = pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open()], maxTiers: 1, baseSize: 0.01 });
    expect(v.allowed).toBe(false);
    expect(v.blockers[0].key).toBe('duplicate-position');
    expect(v.blockers[0].hint).toContain('maxPyramidTiers > 1');
  });

  it('▶ CANARY — an absent or zero maxTiers blocks, never reads as "unlimited"', () => {
    expect(pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open()], maxTiers: 0, baseSize: 0.01 }).allowed).toBe(false);
    expect(pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open()], maxTiers: NaN, baseSize: 0.01 }).allowed).toBe(false);
  });

  it('allows a scale-in when green, locked in and under the tier limit', () => {
    const v = pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open()], maxTiers: 3, baseSize: 0.01 });
    expect(v.allowed).toBe(true);
    expect(v).toMatchObject({ tier: 1, nextTier: 2, maxTiers: 3 });
  });

  it('blocks a scale-in into a loser, before it considers anything else', () => {
    const v = pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open({ profit: -5 })], maxTiers: 3, baseSize: 0.01 });
    expect(v.blockers.map((b) => b.key)).toEqual(['scale-in-not-green']);
  });

  it('blocks when profit is not locked in — the SL must be at breakeven or better', () => {
    const v = pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open({ sl: 9 })], maxTiers: 3, baseSize: 0.01 });
    expect(v.blockers[0].key).toBe('scale-in-not-locked');
  });

  it('blocks at the tier limit', () => {
    const v = pyramidVerdict({ symbol: 'NXXT', side: 'BUY', brokerId: 'mt5', open: [open(), open()], maxTiers: 2, baseSize: 0.01 });
    expect(v.blockers[0].key).toBe('max-tier');
    expect(v.blockers[0].message).toContain('2/2');
  });

  it('a SHORT mirrors the lock rule: the SL must be at or below entry', () => {
    const good = pyramidVerdict({ symbol: 'NXXT', side: 'SELL', brokerId: 'mt5', open: [open({ sl: 9.5 })], maxTiers: 3, baseSize: 0.01 });
    expect(good.allowed).toBe(true);
    const bad = pyramidVerdict({ symbol: 'NXXT', side: 'SELL', brokerId: 'mt5', open: [open({ sl: 10.5 })], maxTiers: 3, baseSize: 0.01 });
    expect(bad.blockers[0].key).toBe('scale-in-not-locked');
  });
});
