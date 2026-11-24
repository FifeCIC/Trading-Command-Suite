/**
 * parity-exposure.spec.ts — every trade must be attributed, and the parts must sum to the whole.
 *
 * ── THE TWO FAILURES THIS PINS ──────────────────────────────────────────────────────────────────
 * 1. A SEVENTH EXIT REASON. `ENGINE_EXIT_REASONS` is the engine's own vocabulary; a reason with no row
 *    in `EXIT_TO_MECHANISM` would be a trade the attribution silently drops, so the shares would add to
 *    less than 100% with no error anywhere. The spec iterates the engine's list, so adding a reason to
 *    the engine fails the build until it is attributed.
 * 2. A MECHANISM WITH NO REGISTER ROW. An attributed mechanism whose id is not in the parity register
 *    would carry verdict `unknown` — reported as such, but the spec asserts the register actually covers
 *    every mechanism the exit map names, so `unknown` can only ever mean a genuine drift.
 *
 * Measured 2026-11-24 on `movers-winners-2026-11-20`: 53 trades — 25 TIME, 28 EOD, zero SL/TRAIL/TP. So
 * the divergent fill mechanisms were never touched while 28 exits could not have happened live at all.
 */
import { parityExposure, EXIT_TO_MECHANISM, ENGINE_EXIT_REASONS } from './parity-exposure';
import { PARITY_REGISTER } from './parity-register';

const trade = (exitReason: string | null, pnl: number) => ({ exitReason, pnl });

describe('EXIT_TO_MECHANISM coverage', () => {
  it('attributes EVERY exit reason the engine can emit', () => {
    const missing = ENGINE_EXIT_REASONS.filter((r) => !EXIT_TO_MECHANISM[r]);
    expect(missing).toEqual([]);
  });

  it('names only mechanisms the parity register actually declares', () => {
    const declared = new Set(PARITY_REGISTER.map((r) => r.id));
    const unknown = Object.entries(EXIT_TO_MECHANISM)
      .filter(([, m]) => !declared.has(m.mechanism))
      .map(([exit, m]) => `${exit} → ${m.mechanism}`);
    expect(unknown).toEqual([]);
  });
});

describe('parityExposure', () => {
  it('attributes each trade to the mechanism that decided it', () => {
    const x = parityExposure([
      trade('TIME', 10),
      trade('TIME', -5),
      trade('SL', -20),
      trade('TRAIL', 30),
    ]);
    const byMech = Object.fromEntries(x.mechanisms.map((m) => [m.mechanism, m]));
    expect(byMech['time-stop'].trades).toBe(2);
    expect(byMech['stop-fill'].trades).toBe(1);
    expect(byMech['trail'].trades).toBe(1);
    expect(x.trades).toBe(4);
  });

  it('THE SUMS ARE THE GUARD: attributed + unmapped equals the whole, in trades and in money', () => {
    const x = parityExposure([
      trade('TIME', 10),
      trade('EOD', 5),
      trade('MYSTERY', 7),
    ]);
    const attributedTrades = x.mechanisms.reduce((a, m) => a + m.trades, 0);
    const attributedPnl = x.mechanisms.reduce((a, m) => a + m.pnl, 0);
    const unmappedTrades = x.unmapped.reduce((a, u) => a + u.trades, 0);
    const unmappedPnl = x.unmapped.reduce((a, u) => a + u.pnl, 0);
    expect(attributedTrades + unmappedTrades).toBe(x.trades);
    expect(Math.round((attributedPnl + unmappedPnl) * 100) / 100).toBe(x.netPnl);
  });

  it('reports an unmapped exit reason instead of dropping it', () => {
    const x = parityExposure([trade('TIME', 1), trade('WAT', 2)]);
    expect(x.unmapped).toHaveLength(1);
    expect(x.unmapped[0].exitReason).toBe('WAT');
    expect(x.unmapped[0].trades).toBe(1);
    expect(x.note).toContain('no mechanism row');
  });

  it('a null exit reason is unmapped, never quietly merged into a mechanism', () => {
    const x = parityExposure([trade(null, 3)]);
    expect(x.unmapped[0].exitReason).toBeNull();
    expect(x.mechanisms).toHaveLength(0);
  });

  it('marks EOD as engine-only, because live has no such event', () => {
    const x = parityExposure([trade('EOD', 100)]);
    const bars = x.mechanisms.find((m) => m.mechanism === 'bars');
    expect(bars.verdict).toBe('engine-only');
    expect(bars.differs).toBe(true);
    expect(x.note).toContain('DATA ran out');
  });

  it('counts divergent mechanisms as differing exposure and sums their P/L', () => {
    const x = parityExposure([trade('TIME', 10), trade('SL', -4), trade('TRAIL', 6)]);
    // TIME is shared; SL (stop-fill) and TRAIL are divergent.
    expect(x.differingTrades).toBe(2);
    expect(x.differingPnl).toBe(2);
  });

  it('reports the end-of-data share, and leads with it when it DOMINATES the result', () => {
    const mostlyEod = parityExposure([trade('EOD', 100), trade('EOD', 50), trade('TIME', 1)]);
    expect(mostlyEod.eodShare).toBeCloseTo(2 / 3, 5);
    expect(mostlyEod.note).toContain('MOST of this result is NOT closed trades');

    const mostlyClosed = parityExposure([trade('TIME', 5), trade('TIME', 5), trade('EOD', 1)]);
    expect(mostlyClosed.eodShare).toBeCloseTo(1 / 3, 5);
    expect(mostlyClosed.note).not.toContain('MOST of this result');
  });

  it('a run that is entirely end-of-data is reported as fully engine-only', () => {
    const x = parityExposure([trade('EOD', 10), trade('EOD', 20)]);
    expect(x.eodShare).toBe(1);
    expect(x.differingTrades).toBe(2);
    expect(x.differingPnl).toBe(30);
  });

  it('a run with no trades says so rather than reporting full exposure', () => {
    const x = parityExposure([]);
    expect(x.trades).toBe(0);
    expect(x.differingTrades).toBe(0);
    expect(x.note).toContain('No trade closed');
  });

  it('survives a missing or non-array trade list', () => {
    expect(parityExposure(null).trades).toBe(0);
    expect(parityExposure(undefined).trades).toBe(0);
  });

  it('sorts the biggest exposure first, so the table reads as a ranking', () => {
    const x = parityExposure([trade('SL', 1), trade('TIME', 1), trade('TIME', 1), trade('TIME', 1)]);
    expect(x.mechanisms[0].mechanism).toBe('time-stop');
    expect(x.mechanisms[1].mechanism).toBe('stop-fill');
  });

  it('tradeShare is a fraction of the run, and 0 rather than NaN when there are none', () => {
    expect(parityExposure([trade('TIME', 1), trade('SL', 1)]).mechanisms[0].tradeShare).toBe(0.5);
    expect(parityExposure([]).mechanisms).toEqual([]);
  });
});
