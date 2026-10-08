/**
 * checkQuoteFreshness() — the #1085 sizing refusal. Every case is pinned here; the canary is
 * recorded in the header of `quote-freshness.ts` (flip `>` to `<` on the allowance comparison →
 * the stale case fails; restore → green).
 */
import { checkQuoteFreshness, FUTURE_TOLERANCE_SECONDS } from './quote-freshness';

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
