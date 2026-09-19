import { ProtocolGatingService } from './protocol-gating.service';

/**
 * getVenueStandby — the SCORING-side venue gate (2026-09-19).
 *
 * ⚠️ WHY THIS EXISTS. The user's report: "there is a XAUUSD card on signals-overview despite the
 * market for that symbol being closed. So there shouldn't be a signal, because there shouldn't be
 * a fresh score either." The envelope layer called this before scoring a protocol's symbols; a
 * standby result must skip scoring entirely and record the reason. If this regresses, closed
 * markets resume producing fresh scores and cards — silently, because a stale quote keeps the
 * freshness check green.
 *
 * Harness note: the method reads ONLY `this.marketCalendar` (plus the pure `venueForSymbol`
 * classifier). Instantiating the full service would need ~15 mocks for a decision that depends on
 * one, so the prototype is borrowed and only the calendar is stubbed. A fake calendar (not a mock
 * framework) keeps both directions — open AND closed — observable in one test.
 */
describe('ProtocolGatingService.getVenueStandby — venue-aware scoring pause', () => {
  function makeService(fxOpen: boolean, usOpen = true): ProtocolGatingService {
    const svc = Object.create(ProtocolGatingService.prototype) as ProtocolGatingService;
    (svc as any).marketCalendar = {
      getMarketStatus: (exchange: string) => {
        if (exchange === 'FX') {
          return fxOpen
            ? { isOpen: true, status: 'open', exchange, nextOpen: null }
            : { isOpen: false, status: 'closed', exchange, nextOpen: '2026-09-20T21:00:00.000Z' };
        }
        return usOpen
          ? { isOpen: true, status: 'open', exchange, nextOpen: null }
          : { isOpen: false, status: 'closed', exchange, nextOpen: '2026-09-21T13:30:00.000Z' };
      },
    };
    return svc;
  }

  it('STANDBY when the only venue is closed — the XAUUSD-on-a-Saturday case', () => {
    const fxClosedSaturday = makeService(false);
    const result = fxClosedSaturday.getVenueStandby(['XAUUSD']);
    expect(result.standby).toBe(true);
    // The reason must name the venue AND when it reopens — the registry renders it verbatim.
    expect(result.reason).toContain('Metals');
    expect(result.reason).toContain('closed');
    expect(result.reason).toContain('2026-09-20T21:00:00.000Z');
  });

  it('NOT standby when the venue is open (the restore direction)', () => {
    const fxOpen = makeService(true);
    expect(fxOpen.getVenueStandby(['XAUUSD']).standby).toBe(false);
  });

  it('NOT standby when ANY venue is open — mixed FX + US protocol keeps scoring', () => {
    const fxClosedUsOpen = makeService(false, true);
    expect(fxClosedUsOpen.getVenueStandby(['XAUUSD', 'NVDA']).standby).toBe(false);
  });

  it('STANDBY when every venue is closed — US stocks on a weekend too', () => {
    const everythingClosed = makeService(false, false);
    expect(everythingClosed.getVenueStandby(['NVDA', 'SPY']).standby).toBe(true);
  });

  it('NEVER standby for crypto — it trades through the weekend', () => {
    const fxClosedSaturday = makeService(false);
    expect(fxClosedSaturday.getVenueStandby(['BTCUSD']).standby).toBe(false);
    // A mixed protocol with a crypto leg can still act on that leg.
    expect(fxClosedSaturday.getVenueStandby(['BTCUSD', 'XAUUSD']).standby).toBe(false);
  });

  it('NEVER standby for unknown venues — "cannot judge" must not read as "closed"', () => {
    const everythingClosed = makeService(false, false);
    expect(everythingClosed.getVenueStandby(['3AMZ']).standby).toBe(false);
    // One unjudgeable symbol in the mix also fails OPEN (no false pause).
    expect(everythingClosed.getVenueStandby(['XAUUSD', '3AMZ']).standby).toBe(false);
  });

  it('NEVER standby for an empty symbol list (no-symbols is a different state)', () => {
    expect(makeService(false).getVenueStandby([]).standby).toBe(false);
  });
});
