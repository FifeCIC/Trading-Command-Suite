/**
 * market-movers.entry-gate.spec.ts — the canary for "may this list open a position?"
 *
 * ⚠️ Every case here is a way a stale or delayed list could reach a trading path and fill at a price
 * that no longer exists — silently, because a fill looks like a fill.
 */
import { entryGate } from './market-movers.service';

const LIMITS = { maxAgeMinutes: 60, maxDelayMinutes: 15 };

describe('entryGate', () => {
  it('allows a fresh, undelayed list', () => {
    expect(entryGate({ ...LIMITS, ageMinutes: 0, delayedByMinutes: 0 }).allowed).toBe(true);
    expect(entryGate({ ...LIMITS, ageMinutes: 5, delayedByMinutes: 15 }).reason).toBeNull();
  });

  it('refuses a stale list and names the age', () => {
    const g = entryGate({ ...LIMITS, ageMinutes: 4392, delayedByMinutes: 0 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('4392 minutes old');
    expect(g.reason).toContain('60-minute');
  });

  it('refuses a delayed list and names the delay', () => {
    const g = entryGate({ ...LIMITS, ageMinutes: 0, delayedByMinutes: 20 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('20 minutes');
    expect(g.reason).toContain('15-minute');
  });

  it('⚠️ an UNREADABLE age is NOT freshness — it cannot be judged, so it is refused', () => {
    // `null` is "the provider gave no usable timestamp", not "0 minutes old". Rendering those the same
    // is how a feed with no clock becomes a feed with no limit.
    const g = entryGate({ ...LIMITS, ageMinutes: null, delayedByMinutes: 0 });
    expect(g.allowed).toBe(false);
    expect(g.reason).toContain('cannot be judged');
  });

  it('⚠️ an unreadable DELAY is not a violation — the provider simply declares none', () => {
    // FMP sends no `exchangeDataDelayedBy`; refusing on absent metadata would refuse every FMP row for
    // a fact that was never claimed. The delay question is unanswered, not failed.
    expect(entryGate({ ...LIMITS, ageMinutes: 1, delayedByMinutes: null }).allowed).toBe(true);
  });

  it('reports BOTH reasons when both fail, rather than the first one found', () => {
    const g = entryGate({ ...LIMITS, ageMinutes: 500, delayedByMinutes: 20 });
    expect(g.reason).toContain('500 minutes old');
    expect(g.reason).toContain('20 minutes');
    expect(g.reason).toContain('; and ');
  });

  it('is boundary-EXCLUSIVE at the limit: equal passes, one over fails', () => {
    expect(entryGate({ ...LIMITS, ageMinutes: 60, delayedByMinutes: 15 }).allowed).toBe(true);
    expect(entryGate({ ...LIMITS, ageMinutes: 61, delayedByMinutes: 15 }).allowed).toBe(false);
    expect(entryGate({ ...LIMITS, ageMinutes: 60, delayedByMinutes: 16 }).allowed).toBe(false);
  });
});
