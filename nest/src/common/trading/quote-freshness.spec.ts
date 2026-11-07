/**
 * checkQuoteFreshness() — the #1085 sizing refusal. Every case is pinned here; the canary is
 * recorded in the header of `quote-freshness.ts` (flip `>` to `<` on the allowance comparison →
 * the stale case fails; restore → green).
 */
import { checkQuoteFreshness, screenTickTime, screenBars, FUTURE_TOLERANCE_SECONDS } from './quote-freshness';

describe('checkQuoteFreshness — an absent quote refuses, and so does a FROZEN one (#1085)', () => {
  const now = new Date('2026-10-08T13:00:00Z');
  const sym = 'XAUUSD';

  it('no quote at all → refusal naming the absence', () => {
    const r = checkQuoteFreshness(null, 300, now);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('no-quote');
  });

  it('a fresh quote passes (30s old)', () => {
    const r = checkQuoteFreshness({ symbol: sym, tickTime: new Date('2026-10-08T12:59:30Z') }, 300, now);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('fresh');
    expect(r.ageSeconds).toBe(30);
  });

  it('THE FIX — a frozen quote REFUSES, distinctly from a missing one', () => {
    const r = checkQuoteFreshness({ symbol: sym, tickTime: new Date('2026-10-08T12:00:00Z') }, 300, now);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('stale');
    expect(r.ageSeconds).toBe(3600);
    expect(r.reason).toContain('over the 300s allowance');
    // The two conditions must not render the same: stale names the tick age, absence its own kind.
    const absent = checkQuoteFreshness(null, 300, now);
    expect(r.kind).not.toBe(absent.kind);
  });

  it('the boundary is INCLUSIVE — exactly the allowance passes, one second more refuses', () => {
    const at = checkQuoteFreshness({ symbol: sym, tickTime: new Date(now.getTime() - 300_000) }, 300, now);
    expect(at.ok).toBe(true);
    const over = checkQuoteFreshness({ symbol: sym, tickTime: new Date(now.getTime() - 301_000) }, 300, now);
    expect(over.ok).toBe(false);
    expect(over.kind).toBe('stale');
  });

  it('an OLD bridge (tickTime undefined) refuses and NAMES the contract', () => {
    const r = checkQuoteFreshness({ symbol: sym } as any, 300, now);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('no-tick-time');
    expect(r.reason).toContain('#1085');
  });

  it('a terminal reporting no tick time (null) refuses — cannot judge is not a pass', () => {
    const r = checkQuoteFreshness({ symbol: sym, tickTime: null }, 300, now);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('no-tick-time');
  });

  it('a tick time far AHEAD of the clock refuses — the offset conversion is suspect', () => {
    const ahead = new Date(now.getTime() + (FUTURE_TOLERANCE_SECONDS + 60) * 1000);
    const r = checkQuoteFreshness({ symbol: sym, tickTime: ahead }, 300, now);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('future');
  });

  it('allowance 0 (or negative) DISABLES the check explicitly', () => {
    const r = checkQuoteFreshness({ symbol: sym, tickTime: new Date('2026-10-01T00:00:00Z') }, 0, now);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('disabled');
  });
});

/**
 * screenTickTime() — the bar/import half of the same question (#1214).
 *
 * ⚠️ This is NOT a second implementation of the freshness rule: it is the same
 * `FUTURE_TOLERANCE_SECONDS`, exported from the same file, applied to a datum that is being STORED
 * rather than used to price an order. Two thresholds for "too far ahead" would guarantee that one
 * path accepts what another refuses.
 */
describe('screenTickTime — a future timestamp cannot be stored (#1214)', () => {
  const now = new Date('2026-11-06T21:54:00Z');

  it('the EURCAD case: 10.7 days ahead is REFUSED, and the lead is reported', () => {
    // Measured live on the bridge 2026-11-06: EURCAD tickTime 2026-11-17T13:59:08Z while every
    // other probe symbol was seconds old.
    const r = screenTickTime(new Date('2026-11-17T13:59:08Z'), now, 'EURCAD tick');
    expect(r.ok).toBe(false);
    expect(r.leadSeconds).toBeGreaterThan(900000);
    expect(r.reason).toContain('AHEAD of the clock');
    expect(r.reason).toContain('EURCAD tick');
  });

  it('a timestamp inside tolerance passes — the guard must not refuse ordinary skew', () => {
    const r = screenTickTime(new Date(now.getTime() + (FUTURE_TOLERANCE_SECONDS - 5) * 1000), now);
    expect(r.ok).toBe(true);
  });

  it('the boundary is exclusive: exactly the tolerance still passes, one second more refuses', () => {
    const at = screenTickTime(new Date(now.getTime() + FUTURE_TOLERANCE_SECONDS * 1000), now);
    const over = screenTickTime(new Date(now.getTime() + (FUTURE_TOLERANCE_SECONDS + 1) * 1000), now);
    expect(at.ok).toBe(true);
    expect(over.ok).toBe(false);
  });

  it('a past timestamp always passes — age is a different question, answered by the allowance', () => {
    const r = screenTickTime(new Date('2026-11-01T00:00:00Z'), now);
    expect(r.ok).toBe(true);
    expect(r.leadSeconds).toBeLessThan(0);
  });

  it('an absent or invalid timestamp is refused, and says which', () => {
    expect(screenTickTime(null, now).reason).toContain('absent');
    expect(screenTickTime(new Date('not a date'), now).reason).toContain('not a valid date');
  });
});

/**
 * screenBars() — the ingest filter (#1214). One bad bar in a page of 200 must be DROPPED, not fatal:
 * losing the other 199 would turn a bad broker tick into a symbol with no data at all.
 */
describe('screenBars — a bad bar is dropped, the rest survive (#1214)', () => {
  const now = new Date('2026-11-06T21:54:00Z');
  const bar = (iso: string) => ({ timestamp: new Date(iso), close: 1 });

  it('keeps the good bars and drops the future one', () => {
    const { accepted, rejected } = screenBars(
      [bar('2026-11-06T21:00:00Z'), bar('2026-11-17T13:59:08Z'), bar('2026-11-06T21:30:00Z')],
      now,
    );
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].timestamp.toISOString()).toBe('2026-11-17T13:59:08.000Z');
  });

  it('a bar with no timestamp is rejected rather than stored undated', () => {
    const { accepted, rejected } = screenBars([{ close: 1 } as any], now);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it('an all-good page passes through untouched', () => {
    const input = [bar('2026-11-06T21:00:00Z'), bar('2026-11-06T21:30:00Z')];
    const { accepted, rejected } = screenBars(input, now);
    // Same objects, not copies — the filter must not rewrite the caller's bars.
    expect(accepted[0]).toBe(input[0]);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });
});
