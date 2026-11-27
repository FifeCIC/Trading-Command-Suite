/**
 * #1359 — the extended-hours assessment must never turn "cannot judge" into "fine", and the
 * three risks the broker named must appear whenever the regular session is not live.
 */
import { assessExtendedHours, assessTickerExtendedHours, EXTENDED_HOURS_RISKS } from './extended-hours';
import type { MarketStatus } from './market-calendar.service';
import type { SymbolVenue } from './market-patterns';

const US: SymbolVenue = { kind: 'venue', exchange: 'US', label: 'US listed' };

const openStatus: MarketStatus = {
  isOpen: true,
  status: 'open',
  exchange: 'US',
  nextOpen: null,
  nextClose: '2026-11-27T21:00:00.000Z',
  minutesUntilClose: 30,
  holidayName: null,
  currentSession: 'US',
};

const afterHoursStatus: MarketStatus = {
  isOpen: false,
  status: 'after-hours',
  exchange: 'US',
  nextOpen: '2026-11-30T14:30:00.000Z',
  nextClose: null,
  minutesUntilClose: null,
  holidayName: null,
  currentSession: null,
};

describe('assessExtendedHours (#1359)', () => {
  it('carries no risks while the regular session is live', () => {
    const a = assessExtendedHours('AAPL', US, openStatus);
    expect(a.inRegularSession).toBe(true);
    expect(a.judged).toBe(true);
    expect(a.risks).toEqual([]);
  });

  it("lists the broker's three risks as soon as the regular session is not live", () => {
    const a = assessExtendedHours('AAPL', US, afterHoursStatus);
    expect(a.inRegularSession).toBe(false);
    expect(a.judged).toBe(true);
    expect(a.venueStatus).toBe('after-hours');
    expect(a.nextOpen).toBe('2026-11-30T14:30:00.000Z');
    expect(a.risks.map((r) => r.id)).toEqual(['liquidity', 'volatility', 'spread']);
    // The risk text is quoted from the broker notice, not re-worded per call site.
    expect(a.risks).toEqual([...EXTENDED_HOURS_RISKS]);
    expect(a.message).toContain('after-hours');
  });

  it('treats crypto as 24/7 rather than gating it on an exchange calendar', () => {
    const a = assessExtendedHours('BTCUSD', { kind: 'crypto', label: 'Crypto (24/7)' });
    expect(a.venueStatus).toBe('continuous');
    expect(a.inRegularSession).toBe(true);
    expect(a.risks).toEqual([]);
  });

  it('reports an unknown venue as UNJUDGED, never as a confident "closed"', () => {
    const a = assessExtendedHours('3AMZ', { kind: 'unknown', label: 'unassigned' });
    expect(a.judged).toBe(false);
    expect(a.venueStatus).toBe('unknown');
    // It still warns — the safe direction — but the message says the window is unknown.
    expect(a.risks.length).toBeGreaterThan(0);
    expect(a.message).toContain('unknown');
  });

  it('resolves the venue itself so callers cannot pass a mismatched exchange', () => {
    const asked: string[] = [];
    const a = assessTickerExtendedHours('AAPL', (exchange) => {
      asked.push(exchange);
      return openStatus;
    });
    expect(asked).toEqual(['US']);
    expect(a.inRegularSession).toBe(true);
  });

  it('does not consult the calendar for a symbol with no exchange venue', () => {
    const asked: string[] = [];
    assessTickerExtendedHours('BTCUSD', (exchange) => {
      asked.push(exchange);
      return openStatus;
    });
    expect(asked).toEqual([]);
  });
});
