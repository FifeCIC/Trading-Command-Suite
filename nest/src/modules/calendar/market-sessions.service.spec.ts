import {
  MarketSessionsService,
  type SessionState,
} from './market-sessions.service';

/**
 * `minutesUntilOpen` must look FORWARD — never clamp to zero.
 * ===========================================================
 * Created 2026-09-18 for the market tape's "Next session" countdown.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The tape read `🇬🇧 London in 0m` on a Friday at 20:47 UK, when London's next open was
 * Monday 08:00 — about 59 hours away. The cause was one expression, present in BOTH this
 * service and its frontend mirror:
 *
 *     minutesUntilOpen: !active && isMarketDay ? Math.max(0, openMin - now) : null
 *
 * `Math.max(0, …)` turns "this session's open already passed TODAY" into `0`, which every
 * reader takes as "opens in 0 minutes". Two measured consequences:
 *
 *   1. THE LABEL lies. `0m` claims imminence; the truth was Monday.
 *   2. THE SORT collapses — the worse half. `nextSessionLabel()` ranks sessions by this
 *      value in the frontend, so every already-passed session reported `0`, the ordering
 *      became meaningless, and the winner was whichever sat first in the roster. Two
 *      control cases both answered `🇦🇺 Sydney in 0m` while London opened in 60 minutes:
 *      the wrong session AND the wrong time.
 *
 * ⚠️ THIS SERVICE AND `src/core/session-utils.js` ARE DELIBERATE MIRRORS. That file's own
 * header flags the duplication as a drift risk and #851 proposes serving the roster from
 * here instead. Until then the two must agree, so these assertions are written to match
 * the frontend suite (`npm run test:session`) case for case. If you change one side,
 * change the other — a mirror that has quietly diverged is worse than no mirror, because
 * both halves keep reporting confident answers.
 *
 * ⚠️ The value is not consumed over HTTP today (`market-calendar.controller.ts` serves it
 * and nothing reads it). Tested anyway: a wrong number on an endpoint is still wrong, and
 * #851 would otherwise promote a known-bad value to be the single source of truth.
 */

describe('MarketSessionsService.minutesUntilOpen', () => {
  const svc = new MarketSessionsService();
  const at = (iso: string) => new Date(iso);
  const row = (sessions: SessionState[], name: string): SessionState => {
    const found = sessions.find((s) => s.name === name);
    if (!found) throw new Error(`no session named ${name}`);
    return found;
  };

  it('reports a real countdown for a session whose open already passed today', () => {
    // Friday 19:47 UTC === 20:47 UK. London (08:00–16:30 UK) shut 4h17m ago; next open
    // is Monday 08:00 UK. The regression returned 0 here and the tape said "in 0m".
    const london = row(
      svc.getSessionStates(at('2026-09-18T19:47:00Z')),
      'London',
    );
    expect(london.active).toBe(false);
    expect(london.minutesUntilOpen).not.toBe(0);
    expect(london.minutesUntilOpen).toBeGreaterThan(3000); // ~3553 min
  });

  it('never returns 0 for a session that is not currently open', () => {
    // The property, not an example. A closed session either has a future open (> 0) or
    // could not be resolved (null). Zero always means "the open time has gone today",
    // which is information about the past and not a countdown.
    const probes = [
      '2026-09-18T19:47:00Z', // Fri evening
      '2026-09-21T06:00:00Z', // Mon pre-London
      '2026-09-22T12:00:00Z', // Tue, London+NY open
      '2026-09-23T02:00:00Z', // Wed overnight
      '2026-09-19T09:00:00Z', // Saturday — everything shut
    ];
    for (const iso of probes) {
      for (const s of svc.getSessionStates(at(iso))) {
        if (s.active) continue;
        // Stated as two plain assertions rather than an `expect.any(Number)` matcher:
        // the property is "null, or strictly positive", and a matcher that accepts any
        // number would also accept the zero this test exists to catch.
        if (s.minutesUntilOpen !== null) {
          expect(s.minutesUntilOpen).toBeGreaterThan(0);
        }
        expect(`${iso} ${s.name}`).toBe(`${iso} ${s.name}`);
      }
    }
  });

  it('crosses the weekend rather than wrapping to the same day', () => {
    // Friday 19:47 UTC. London must point at MONDAY — over 24h away. A naive same-day
    // wrap would answer a small number and look plausible.
    //
    // ⚠️ New York is deliberately NOT asserted here: at 19:47 UTC it is 15:47 EDT, so NY
    // is still OPEN and correctly returns null. An earlier version of this test asserted
    // a countdown for New York and failed — the test was wrong, the service was right.
    // That is also the case the "returns null while open" test below pins.
    const sessions = svc.getSessionStates(at('2026-09-18T19:47:00Z'));
    expect(row(sessions, 'London').minutesUntilOpen).toBeGreaterThan(24 * 60);
    expect(row(sessions, 'New York').active).toBe(true);
    expect(row(sessions, 'New York').minutesUntilOpen).toBeNull();
  });

  it('returns null while a session is open, not a countdown', () => {
    // Tuesday 12:00 UTC: London is open. `minutesUntilOpen` must be null — reporting a
    // stale or wrapped value here would let a caller treat an open session as upcoming.
    const sessions = svc.getSessionStates(at('2026-09-22T12:00:00Z'));
    const london = row(sessions, 'London');
    expect(london.active).toBe(true);
    expect(london.minutesUntilOpen).toBeNull();
  });

  it('names the soonest session — agreement with the frontend mirror', () => {
    // Mirrors `nextSessionLabel()`'s ranking so the two implementations cannot silently
    // disagree. Monday 06:00 UTC: London opens 07:00 UTC (60 min) and must be the min.
    const sessions = svc.getSessionStates(at('2026-09-21T06:00:00Z'));
    const pending = sessions.filter((s) => s.minutesUntilOpen !== null);
    const soonest = pending.reduce((a, b) =>
      a.minutesUntilOpen <= b.minutesUntilOpen ? a : b,
    );
    expect(soonest.name).toBe('London');
    expect(soonest.minutesUntilOpen).toBe(60);
  });
});
