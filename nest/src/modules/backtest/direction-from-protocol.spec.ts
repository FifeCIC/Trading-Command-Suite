/**
 * direction-from-protocol.spec.ts — the canary for a SILENTLY EMPTY backtest.
 *
 * ⚠️ Every case here corresponds to a way a run can return a complete, plausible result that measured
 * nothing: a short protocol run long discards 100% of its signals without an error, so the failure
 * looks exactly like a strategy that never triggers.
 */
import { directionFromProtocol } from './direction-from-protocol';

describe('directionFromProtocol', () => {
  it('derives short from a SHORT_ONLY protocol — the case that produced 0 trades', () => {
    // Measured 2026-11-19: APPS / movers-losers-2026-11-10 / 5m, same bars and protocol —
    // no direction gave 0 trades, 'short' gave 173. This assertion is the regression.
    expect(directionFromProtocol(undefined, 'SHORT_ONLY')).toBe('short');
    expect(directionFromProtocol(null, 'SHORT_ONLY')).toBe('short');
    expect(directionFromProtocol(undefined, 'short')).toBe('short');
  });

  it('derives long from a LONG_ONLY protocol', () => {
    expect(directionFromProtocol(undefined, 'LONG_ONLY')).toBe('long');
    expect(directionFromProtocol(null, 'long')).toBe('long');
  });

  it('⚠️ an EXPLICIT request always wins — a contrarian run is not silently corrected', () => {
    // A deliberate "measure this short protocol long" is legitimate; deriving must never overrule it.
    expect(directionFromProtocol('long', 'SHORT_ONLY')).toBe('long');
    expect(directionFromProtocol('short', 'LONG_ONLY')).toBe('short');
    expect(directionFromProtocol('both', 'LONG_ONLY')).toBe('both');
  });

  it("⚠️ never derives 'both' — that mode is refused on the run path", () => {
    // Returning 'both' here would defeat refuseUnrunnableDirection() and store an unrunnable run.
    for (const d of ['BOTH', 'LONG_SHORT', 'both', '']) {
      expect(directionFromProtocol(undefined, d)).not.toBe('both');
    }
  });

  it('falls back to long when the protocol direction is absent — unchanged from the old default', () => {
    for (const d of [null, undefined, '', '   ', 'UNKNOWN']) {
      expect(directionFromProtocol(undefined, d)).toBe('long');
    }
  });
});
