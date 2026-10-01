/**
 * close-time.spec.ts — `closedAt` is a broker time OR an app-noticed time, and a duration must
 * never be reported when it is the second (#1045).
 *
 * The dangerous failure is a plausible number: 587 hours of "holding time" is 24 days, and the
 * bots here scalp on minute cadences. Nothing errors — the average is just wrong.
 */
import { closeTimeIsBrokerDerived, tradeLifetimeHours, meanLifetimeHours } from './close-time';

describe('closeTimeIsBrokerDerived', () => {
  it('an exit price proves the broker supplied evidence', () => {
    expect(closeTimeIsBrokerDerived({ closedAt: 'x', exitPrice: 1.16 })).toBe(true);
  });

  it('no exit price AND flagged is NOT broker-derived', () => {
    expect(closeTimeIsBrokerDerived({ closedAt: 'x', exitPrice: null, pnlInvalid: 1 })).toBe(false);
  });

  it('no exit price and NOT flagged is still broker-derived — the flag is the weaker signal', () => {
    // An exit price is the primary evidence. The flag is accepted as a second signal because it is
    // set on the same condition, but its absence must not erase a row the exit price vouched for.
    expect(closeTimeIsBrokerDerived({ closedAt: 'x', exitPrice: null, pnlInvalid: 0 })).toBe(true);
  });

  it('an open trade has no close time at all', () => {
    expect(closeTimeIsBrokerDerived({ closedAt: null, exitPrice: 1.16 })).toBe(false);
  });
});

describe('tradeLifetimeHours', () => {
  it('measures a broker-derived close', () => {
    expect(tradeLifetimeHours({
      openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-01T12:30:00Z', exitPrice: 1.16,
    })).toBeCloseTo(2.5, 6);
  });

  it('returns NULL — not the raw difference — when the close time is app-noticed', () => {
    // This is the whole point of the module. The raw difference here is 24 days; reporting it would
    // enter a reconciliation delay into an average of holding times.
    expect(tradeLifetimeHours({
      openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-25T10:00:00Z',
      exitPrice: null, pnlInvalid: 1,
    })).toBeNull();
  });

  it('returns NULL — not 0 — for a missing timestamp, so an unknown cannot read as instant', () => {
    expect(tradeLifetimeHours({ openedAt: null, closedAt: '2026-09-01T12:00:00Z', exitPrice: 1.16 })).toBeNull();
    expect(tradeLifetimeHours({ openedAt: '2026-09-01T12:00:00Z', closedAt: null, exitPrice: 1.16 })).toBeNull();
  });

  it('returns NULL for an unparseable timestamp rather than NaN', () => {
    expect(tradeLifetimeHours({ openedAt: 'not-a-date', closedAt: '2026-09-01T12:00:00Z', exitPrice: 1.16 })).toBeNull();
  });

  it('returns NULL for an INVERTED pair — never a negative duration', () => {
    expect(tradeLifetimeHours({
      openedAt: '2026-09-01T12:00:00Z', closedAt: '2026-09-01T10:00:00Z', exitPrice: 1.16,
    })).toBeNull();
  });

  it('a genuine instant close is 0, and that is a real measurement', () => {
    expect(tradeLifetimeHours({
      openedAt: '2026-09-01T12:00:00Z', closedAt: '2026-09-01T12:00:00Z', exitPrice: 1.16,
    })).toBe(0);
  });
});

describe('meanLifetimeHours', () => {
  it('averages only the measurable rows and reports how many were skipped', () => {
    const r = meanLifetimeHours([
      { openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-01T12:00:00Z', exitPrice: 1.1 }, // 2h
      { openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-01T14:00:00Z', exitPrice: 1.1 }, // 4h
      { openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-25T10:00:00Z', exitPrice: null, pnlInvalid: 1 }, // skipped
    ]);
    expect(r.hours).toBeCloseTo(3, 6);
    expect(r.measured).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it('reports hours = null when NOTHING is measurable — never 0', () => {
    const r = meanLifetimeHours([{ closedAt: 'x', exitPrice: null, pnlInvalid: 1 }]);
    expect(r.hours).toBeNull();
    expect(r.measured).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('an empty input reports null, not 0', () => {
    expect(meanLifetimeHours([])).toEqual({ hours: null, measured: 0, skipped: 0 });
  });
});
