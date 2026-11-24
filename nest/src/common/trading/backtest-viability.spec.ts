/**
 * backtest-viability.spec.ts — a run that cannot close a trade must say so, and must NOT say so wrongly.
 *
 * ── THE FAILURE THIS PINS, IN BOTH DIRECTIONS ──────────────────────────────────────────────────
 * The banner this module produces tells a reader their total is a mark of open positions. So it must fire
 * when that is true **and stay silent when it is not** — a false positive would discredit every real
 * result, which is worse than the silence it replaced. Both directions are asserted here, plus the
 * "cannot judge" cases that must never be reported as "unreachable".
 *
 * Measured 2026-11-24: `maxHoldHours: 10` against a 6.5h US session ⇒ the time stop cannot fire, and both
 * movers days produced 100% end-of-data exits.
 */
import { viabilityOf, timeStopReachable, sessionSpanMinutes } from './backtest-viability';

const US_SESSION_MIN = 390; // 6.5 hours, measured from `marketbar` on 2026-11-20

describe('timeStopReachable', () => {
  it('is FALSE when the hold reaches past the data and no boundary is declared', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 10, exitBeforeUtc: null, sessionSpanMinutes: US_SESSION_MIN })).toBe(false);
  });

  it('is TRUE when the hold fits inside the session', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 4, exitBeforeUtc: null, sessionSpanMinutes: US_SESSION_MIN })).toBe(true);
  });

  it('is TRUE when a boundary is declared, because the clock flattens the position anyway', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 10, exitBeforeUtc: '20:45', sessionSpanMinutes: US_SESSION_MIN })).toBe(true);
  });

  it('is TRUE when the span is UNKNOWN — "cannot judge" is not "unreachable"', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 10, sessionSpanMinutes: null })).toBe(true);
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 10 })).toBe(true);
  });

  it('is TRUE when no hold is declared', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: null, sessionSpanMinutes: US_SESSION_MIN })).toBe(true);
  });

  it('treats the boundary as inclusive — a hold exactly equal to the span reaches the last bar', () => {
    expect(timeStopReachable({ trades: 1, endOfDataTrades: 1, maxHoldHours: 6.5, sessionSpanMinutes: US_SESSION_MIN })).toBe(true);
  });
});

describe('viabilityOf', () => {
  it('reports mark-only when EVERY trade ended with the data, and names the arithmetic', () => {
    const v = viabilityOf({ trades: 18, endOfDataTrades: 18, maxHoldHours: 10, exitBeforeUtc: null, sessionSpanMinutes: US_SESSION_MIN });
    expect(v.verdict).toBe('mark-only');
    expect(v.timeStopReachable).toBe(false);
    expect(v.why).toContain('MARK of an open position');
    expect(v.why).toContain('10h');
    expect(v.why).toContain('6.5h');
  });

  it('does NOT claim mark-only when even one trade closed on a decision', () => {
    const v = viabilityOf({ trades: 18, endOfDataTrades: 17, maxHoldHours: 10, exitBeforeUtc: null, sessionSpanMinutes: US_SESSION_MIN });
    expect(v.verdict).toBe('decision-exits');
    expect(v.why).toContain('1 of 18');
    // The arithmetic is still reported — the time stop is genuinely unreachable — but the verdict is not
    // promoted to "this is not a result" on the strength of it.
    expect(v.timeStopReachable).toBe(false);
  });

  it('says nothing about exits when no trade closed', () => {
    const v = viabilityOf({ trades: 0, endOfDataTrades: 0, maxHoldHours: 10, sessionSpanMinutes: US_SESSION_MIN });
    expect(v.verdict).toBe('no-trades');
    expect(v.why).toContain('says nothing');
  });

  it('mark-only WITHOUT blaming the hold when the arithmetic does not support it', () => {
    const v = viabilityOf({ trades: 5, endOfDataTrades: 5, maxHoldHours: 2, exitBeforeUtc: null, sessionSpanMinutes: US_SESSION_MIN });
    expect(v.verdict).toBe('mark-only');
    expect(v.timeStopReachable).toBe(true);
    // No invented cause: the hold fits, so the reason is simply that the data ended before any exit fired.
    expect(v.why).not.toContain('cannot fire at all');
  });

  it('never returns an empty reason', () => {
    for (const input of [
      { trades: 0, endOfDataTrades: 0 },
      { trades: 3, endOfDataTrades: 3 },
      { trades: 3, endOfDataTrades: 1 },
    ]) {
      expect(viabilityOf(input).why.length).toBeGreaterThan(10);
    }
  });
});

describe('sessionSpanMinutes', () => {
  it('measures the span from the bars, not from a session name', () => {
    const bars = [
      { timestamp: '2026-11-20T14:30:00.000Z' },
      { timestamp: '2026-11-20T21:00:00.000Z' },
    ];
    expect(sessionSpanMinutes(bars)).toBe(390);
  });

  it('returns null rather than 0 when it cannot measure', () => {
    expect(sessionSpanMinutes([])).toBeNull();
    expect(sessionSpanMinutes([{ timestamp: '2026-11-20T14:30:00.000Z' }])).toBeNull();
    expect(sessionSpanMinutes(null)).toBeNull();
    expect(sessionSpanMinutes([{ timestamp: 'nonsense' }, { timestamp: 'worse' }])).toBeNull();
  });

  it('uses the FIRST and LAST bar, so an unordered series still measures correctly', () => {
    const bars = [
      { timestamp: '2026-11-20T21:00:00.000Z' },
      { timestamp: '2026-11-20T14:30:00.000Z' },
    ];
    expect(sessionSpanMinutes(bars)).toBe(390);
  });
});
