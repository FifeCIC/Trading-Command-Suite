/**
 * fixed-units.spec.ts — canary for `resolveFixedUnits()`.
 *
 * This function decides the one size in the backtester that is meant to EQUAL the live bot's position,
 * so both failure directions are silent and expensive:
 *   • prefer the bot's size when the operator typed one → the run measures a configuration nobody asked for
 *   • fall back to something when neither is available     → a plausible P&L attributed to a size that
 *                                                            does not exist (the 5× mismatch, #1143)
 *
 * The refusal is asserted by its MESSAGE, not just by "it throws": the message is what tells the reader
 * whether the request was short or the symbol has no route, and those are different fixes.
 */
import { resolveFixedUnits } from './fixed-units';

describe('resolveFixedUnits', () => {
  it("uses the operator's number when one was supplied", () => {
    expect(resolveFixedUnits({ requested: 2.5, symbol: 'US30' })).toEqual({ units: 2.5, source: 'requested' });
  });

  it('prefers the explicit size OVER the bot, because it was typed deliberately', () => {
    const r = resolveFixedUnits({ requested: 1, botBaseSize: 0.1, contractSize: 100, symbol: 'XAUUSD' });
    expect(r.units).toBe(1);
    expect(r.source).toBe('requested');
  });

  it("derives the bot's own size as baseSize × contractSize", () => {
    // The live quantity. `Gold Macro Position` is 0.01 lots of XAUUSD at contractSize 100 = 1 oz.
    const r = resolveFixedUnits({ botBaseSize: 0.01, contractSize: 100, symbol: 'XAUUSD' });
    expect(r.units).toBeCloseTo(1, 10);
    expect(r.source).toBe('bot');
  });

  it('derives a fractional size for a 0.1-lot index bot', () => {
    // VIX bot baseSize 0.1, contractSize 1 — the configuration verified end to end (320 trades at 0.1).
    const r = resolveFixedUnits({ botBaseSize: 0.1, contractSize: 1, symbol: 'VIX' });
    expect(r.units).toBeCloseTo(0.1, 10);
    expect(r.source).toBe('bot');
  });

  it('REFUSES rather than inventing a size when neither input exists', () => {
    expect(() => resolveFixedUnits({ symbol: 'XAUUSD' })).toThrow(/needs a size/);
  });

  it('refuses when the bot is known but the contract size is not — and says which is missing', () => {
    // Measured 2026-11-01: XAUUSD has no `symbol_route` row, so its contract size cannot be resolved.
    // A message that only said "needs a size" would send the reader to the request, which was fine.
    expect(() => resolveFixedUnits({ botBaseSize: 0.01, symbol: 'XAUUSD' })).toThrow(
      /contract size=not found for XAUUSD/,
    );
  });

  it('refuses when the contract size is known but no bot was named', () => {
    expect(() => resolveFixedUnits({ contractSize: 100, symbol: 'XAUUSD' })).toThrow(/bot baseSize=none/);
  });

  it('treats a zero or negative size as MISSING, never as a size of zero', () => {
    // A zero would size every trade to nothing and look like "the protocol never signalled".
    expect(() => resolveFixedUnits({ requested: 0, botBaseSize: 0, contractSize: 100, symbol: 'XAUUSD' })).toThrow(
      /needs a size/,
    );
    expect(() => resolveFixedUnits({ requested: -5, symbol: 'XAUUSD' })).toThrow(/needs a size/);
  });

  it('treats a non-finite size as MISSING', () => {
    expect(() => resolveFixedUnits({ requested: Number.NaN, symbol: 'XAUUSD' })).toThrow(/needs a size/);
    expect(() => resolveFixedUnits({ requested: Infinity, symbol: 'XAUUSD' })).toThrow(/needs a size/);
  });

  it('settles in a plain number of 0.1 × 100 without floating-point dust', () => {
    // 0.1 × 100 is 10.000000000000002 in IEEE754 for some inputs; a stored run should hold 10.
    const r = resolveFixedUnits({ botBaseSize: 0.07, contractSize: 100, symbol: 'XAUUSD' });
    expect(Number.isFinite(r.units)).toBe(true);
    expect(r.units).toBeCloseTo(7, 10);
  });
});
