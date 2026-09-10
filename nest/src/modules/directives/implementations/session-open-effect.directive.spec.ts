import { SessionOpenEffectDirective } from './session-open-effect.directive';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * Regression test for the session-open window bug (epic #731, 2026-09-10).
 *
 * `session-open-effect` is `ready` and sits in 10 active protocols, yet the
 * scoring DB held 6,308 of its evaluations with a single distinct value: 0.
 * Cause: the session's local open was converted to an instant with
 * `new Date(onDay.toLocaleString('en-US', { timeZone }))`, which parses the
 * zone wall clock in MACHINE-local time — correct only when the machine's zone
 * matches the session's. On a Europe/London box the NY open landed 5 hours early
 * and the Tokyo open 8 hours late, so the ±30-minute window almost never matched.
 *
 * This test pins the behaviour that was impossible before the fix: a bar at the
 * real NY open leaves the "outside active window" branch.
 */
describe('session-open-effect — fires at a real session open', () => {
  // Minimal stand-in for MarketSessionsService: only getSession() is used.
  const sessions: Record<string, any> = {
    tokyo: { scope: 'tokyo', name: 'Tokyo', iana: 'Asia/Tokyo', open: '09:00', close: '15:00' },
    london: { scope: 'london', name: 'London', iana: 'Europe/London', open: '08:00', close: '16:30' },
    ny: { scope: 'ny', name: 'New York', iana: 'America/New_York', open: '09:30', close: '16:00' },
  };
  const marketSessions = { getSession: (scope: string) => sessions[scope] } as any;

  /** 40 bars ending at `endIso`, each 15m apart, drifting up by 0.5% overall. */
  function barsEndingAt(endIso: string, drift = 0.005): MarketBar[] {
    const end = new Date(endIso).getTime();
    const out: MarketBar[] = [];
    for (let i = 39; i >= 0; i--) {
      const step = (39 - i) / 39;
      const close = 100 * (1 - drift / 2 + drift * step);
      out.push({
        timestamp: new Date(end - i * 15 * 60_000),
        open: close - 0.05,
        high: close + 0.1,
        low: close - 0.1,
        close,
        volume: 1_000_000,
      });
    }
    return out;
  }

  it('leaves the outside-window branch at the New York open', () => {
    const d = new SessionOpenEffectDirective(marketSessions);
    // 2026-09-10 13:30Z is exactly 09:30 in New York (EDT).
    const r = d.calculate({ symbol: 'SPY', bars: barsEndingAt('2026-09-10T13:30:00Z') });

    expect(r.reason).not.toMatch(/outside active window/);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(d.maxScore);
  });

  it('leaves the outside-window branch at the Tokyo open', () => {
    const d = new SessionOpenEffectDirective(marketSessions);
    // 2026-09-10 00:00Z is exactly 09:00 in Tokyo (JST).
    const r = d.calculate({ symbol: 'USDJPY', bars: barsEndingAt('2026-09-10T00:00:00Z') });

    expect(r.reason).not.toMatch(/outside active window/);
    expect(r.score).toBeGreaterThan(0);
  });

  it('stays out of signal midway between opens', () => {
    const d = new SessionOpenEffectDirective(marketSessions);
    // 03:00Z is 4h past Tokyo and 4h before London — no session nearby.
    const r = d.calculate({ symbol: 'EURUSD', bars: barsEndingAt('2026-09-10T03:00:00Z') });

    expect(r.reason).toMatch(/outside active window/);
    expect(r.score).toBe(0);
  });
});
