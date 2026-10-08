/**
 * planPreOpenSession() — the ADVISORY pre-open alert decision (#981).
 *
 * ⚠️ TWO PROPERTIES ARE PINNED HERE, BOTH PAID FOR ELSEWHERE IN THE REPO:
 *
 * 1. THE TITLE IS THE COLLAPSE KEY. Alerts fold on (type, title) over UNDISMISSED rows, so a title
 *    carrying the minute count would insert one row per tick — the measured shape of "1 MT5
 *    Bridge(s) Down" ×2,210. The stability tests call the planner with DIFFERENT minute counts
 *    (27 → 26, two real ticks) and require the SAME title, and with different dates and require
 *    different titles.
 *
 * 2. "CANNOT JUDGE" IS NOT "NO ALERT". A missing roster row, or an unresolvable next-open, returns
 *    `unknown` — never `none`. Absence is not a negative.
 *
 * Canary (observed 2026-10-08): embedding `${m}` in the title fails the stability test; restore →
 * all green.
 */
import { planPreOpenSession, PRE_OPEN_SESSION } from './pre-open-session';
import type { SessionState } from './market-sessions.service';

const state = (
  scope: SessionState['scope'],
  active: boolean,
  minutesUntilOpen: number | null,
  name = scope,
): SessionState => ({
  scope,
  name,
  flag: 'X',
  active,
  openMinutes: 570,
  closeMinutes: 960,
  nowMinutes: 0,
  minutesUntilClose: active ? 120 : null,
  minutesUntilOpen,
  closesSoon: false,
  opensSoon: false,
});

const ROSTER_SHUT = [
  state('sydney', false, 300),
  state('tokyo', false, 120),
  state('london', true, null),
  state('ny', false, 90, 'New York'),
];

describe('planPreOpenSession (#981)', () => {
  it('threshold 0 is DISABLED — a deliberate configuration, not a failure', () => {
    const out = planPreOpenSession({ states: ROSTER_SHUT, thresholdMinutes: 0, botNames: [], openPositions: 0 });
    expect(out.kind).toBe('disabled');
  });

  it('a roster without the watched session is UNKNOWN — never "none"', () => {
    const out = planPreOpenSession({
      states: ROSTER_SHUT.filter((s) => s.scope !== 'ny'),
      thresholdMinutes: 30,
      botNames: [],
      openPositions: 0,
    });
    expect(out.kind).toBe('unknown');
  });

  it('session open now → none/open', () => {
    const out = planPreOpenSession({
      states: [state('ny', true, null, 'New York')],
      thresholdMinutes: 30,
      botNames: [],
      openPositions: 0,
    });
    expect(out.kind).toBe('none');
    if (out.kind === 'none') expect(out.reason).toBe('session-open');
  });

  it('not open AND no resolvable next-open → UNKNOWN — absence is not a negative', () => {
    const out = planPreOpenSession({
      states: [state('ny', false, null, 'New York')],
      thresholdMinutes: 30,
      botNames: [],
      openPositions: 0,
    });
    expect(out.kind).toBe('unknown');
  });

  it('outside the window → none/outside-window, and the boundary is INCLUSIVE', () => {
    const at31 = planPreOpenSession({ states: ROSTER_SHUT, thresholdMinutes: 30, botNames: [], openPositions: 0 });
    expect(at31.kind).toBe('none'); // 90 > 30

    const at30 = planPreOpenSession({
      states: [state('ny', false, 30, 'New York')],
      thresholdMinutes: 30,
      botNames: [],
      openPositions: 0,
    });
    expect(at30.kind).toBe('alert'); // 30 <= 30 — fires on the boundary tick

    const at31b = planPreOpenSession({
      states: [state('ny', false, 31, 'New York')],
      thresholdMinutes: 30,
      botNames: [],
      openPositions: 0,
    });
    expect(at31b.kind).toBe('none');
  });

  it('inside the window → an alert that names the session, the minutes, the bots and the positions', () => {
    const out = planPreOpenSession({
      states: [state('ny', false, 27, 'New York')],
      thresholdMinutes: 30,
      botNames: ['Gold Day-Trade M15', 'US Open Bot', 'VIX Short', 'Oil Speed', 'Fifth', 'Sixth'],
      openPositions: 3,
      at: new Date('2026-10-08T12:30:00Z'),
    });
    expect(out.kind).toBe('alert');
    if (out.kind !== 'alert') return;
    expect(out.detail).toContain(PRE_OPEN_SESSION.label);      // the session
    expect(out.detail).toContain('27 minute');                  // the minutes
    expect(out.detail).toContain('6 bot(s)');                   // the bots (count)
    expect(out.detail).toContain('+2 more');                    // …and the overflow
    expect(out.detail).toContain('Open positions right now: 3'); // the positions
    expect(out.detail).toContain('no automatic trade action');  // the owner's constraint, verbatim in spirit
    expect(out.title).toContain('2026-10-08');                  // day-scoped
  });

  it('COLLAPSE KEY — the title is stable across ticks (different minutes) and day-scoped (different dates)', () => {
    const tick1 = planPreOpenSession({
      states: [state('ny', false, 27, 'New York')], thresholdMinutes: 30, botNames: [], openPositions: 1,
      at: new Date('2026-10-08T12:33:00Z'),
    });
    const tick2 = planPreOpenSession({
      states: [state('ny', false, 26, 'New York')], thresholdMinutes: 30, botNames: [], openPositions: 1,
      at: new Date('2026-10-08T12:34:00Z'),
    });
    const nextDay = planPreOpenSession({
      states: [state('ny', false, 28, 'New York')], thresholdMinutes: 30, botNames: [], openPositions: 1,
      at: new Date('2026-10-09T12:33:00Z'),
    });
    expect(tick1.kind).toBe('alert');
    expect(tick2.kind).toBe('alert');
    expect(nextDay.kind).toBe('alert');
    if (tick1.kind !== 'alert' || tick2.kind !== 'alert' || nextDay.kind !== 'alert') return;
    expect(tick1.title).toBe(tick2.title);        // ONE row for a whole window
    expect(tick1.title).not.toBe(nextDay.title);  // a new day is a new alert
    // And the numbers that change per tick live in `detail`, which the collapse updates in place.
    expect(tick1.detail).not.toBe(tick2.detail);
  });
});
