import { MarketCalendarService } from './market-calendar.service';

/**
 * MarketCalendarService — the VENUE axis ("is this exchange/market open?").
 *
 * ⚠️ WHAT THESE PIN (measured 2026-09-19)
 * ---------------------------------------
 * 1. THE INSTANT FIX. `nextOpen`/`nextClose` used to be built by re-parsing the venue's
 *    wall clock as SERVER-local time, so every instant was wrong by (server offset − venue
 *    offset). Live evidence: from a Saturday, `getMarketStatus('US').nextOpen` answered
 *    **08:30Z Monday** when the true Monday open (09:30 America/New_York, EDT) is **13:30Z**.
 *    The first test below is the canary — restore the old round-trip and it fails.
 * 2. THE FX WEEK. The `FX` venue is weekly (Sunday 22:00 → Friday 22:00 London), which the
 *    daily `daysOfWeek` model cannot express. Summer (BST) and winter (GMT) cases are both
 *    pinned because a DST slip is a one-hour lie that looks plausible.
 *
 * All expected instants were derived from the IANA zone rules for 2026, independently of
 * the implementation: EDT = UTC−4 until 2026-11-01; BST = UTC+1 until 2026-10-25.
 */
describe('MarketCalendarService — venue status and instants', () => {
  let cal: MarketCalendarService;

  beforeEach(() => {
    cal = new MarketCalendarService();
  });

  describe('US session — the instant fix (canary)', () => {
    it('from a Saturday, nextOpen is MONDAY 13:30Z — not the old 08:30Z server-local answer', () => {
      const status = cal.getMarketStatus('US', new Date('2026-09-19T12:35:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('closed');
      expect(status.nextOpen).toBe('2026-09-21T13:30:00.000Z'); // Mon 09:30 EDT
    });

    it('winter (EST): from a Saturday, nextOpen is Monday 14:30Z', () => {
      const status = cal.getMarketStatus('US', new Date('2026-12-12T15:00:00Z'));
      expect(status.nextOpen).toBe('2026-12-14T14:30:00.000Z'); // Mon 09:30 EST
    });

    it('pre-market: 09:00 New York reports pre-market with today’s open instant', () => {
      const status = cal.getMarketStatus('US', new Date('2026-09-16T13:00:00Z')); // Wed 09:00 EDT
      expect(status.status).toBe('pre-market');
      expect(status.isOpen).toBe(false);
      expect(status.nextOpen).toBe('2026-09-16T13:30:00.000Z');
      expect(status.nextClose).toBe('2026-09-16T20:00:00.000Z'); // 16:00 EDT
    });

    it('open: 10:00 New York reports open with the correct close instant and countdown', () => {
      const status = cal.getMarketStatus('US', new Date('2026-09-16T14:00:00Z'));
      expect(status.isOpen).toBe(true);
      expect(status.nextClose).toBe('2026-09-16T20:00:00.000Z');
      expect(status.minutesUntilClose).toBe(360); // 14:00Z → 20:00Z
    });

    it('holiday: Christmas Day 2026 is closed and names the holiday', () => {
      const status = cal.getMarketStatus('US', new Date('2026-12-25T15:00:00Z')); // Fri 10:00 EST
      expect(status.isOpen).toBe(false);
      expect(status.holidayName).toBe('Christmas Day');
    });
  });

  describe('FX venue — the broker’s week (weekly window)', () => {
    it('Saturday: closed, next open Sunday 22:00 London = 21:00Z (BST)', () => {
      const status = cal.getMarketStatus('FX', new Date('2026-09-19T12:00:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('closed');
      expect(status.nextOpen).toBe('2026-09-20T21:00:00.000Z');
      expect(status.nextClose).toBeNull();
    });

    it('Sunday before the open (21:00 BST): still closed, opens the same day', () => {
      const status = cal.getMarketStatus('FX', new Date('2026-09-20T20:00:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.nextOpen).toBe('2026-09-20T21:00:00.000Z');
    });

    it('Sunday after the open (22:30 BST): open, next close is Friday 21:00Z', () => {
      const status = cal.getMarketStatus('FX', new Date('2026-09-20T21:30:00Z'));
      expect(status.isOpen).toBe(true);
      expect(status.nextClose).toBe('2026-09-25T21:00:00.000Z'); // Fri 22:00 BST
      expect(status.minutesUntilClose).toBeGreaterThan(0);
    });

    it('Monday: open, next close is that week’s Friday 21:00Z', () => {
      const status = cal.getMarketStatus('FX', new Date('2026-09-21T10:00:00Z'));
      expect(status.isOpen).toBe(true);
      expect(status.nextClose).toBe('2026-09-25T21:00:00.000Z');
    });

    it('Friday after the close (22:30 BST): closed, next open is Sunday', () => {
      const status = cal.getMarketStatus('FX', new Date('2026-09-25T21:30:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.nextOpen).toBe('2026-09-27T21:00:00.000Z'); // Sun 22:00 BST
    });

    it('winter (GMT): the Sunday open is 22:00Z, not 21:00Z', () => {
      const status = cal.getMarketStatus('FX', new Date('2027-01-09T12:00:00Z')); // Saturday
      expect(status.isOpen).toBe(false);
      expect(status.nextOpen).toBe('2027-01-10T22:00:00.000Z'); // Sun 22:00 GMT
    });
  });

  describe('unknown venue', () => {
    it('fails CLOSED with no invented instants (pinned — see #850)', () => {
      const status = cal.getMarketStatus('XX', new Date('2026-09-16T14:00:00Z'));
      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('closed');
      expect(status.nextOpen).toBeNull();
      expect(status.nextClose).toBeNull();
    });
  });
});
