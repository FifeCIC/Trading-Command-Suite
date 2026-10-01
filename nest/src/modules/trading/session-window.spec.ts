/**
 * Session-gate + name/window audit contract (#759)
 * ================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The session gate was correct code doing a job nobody could see. Three seeded
 * bots — "Sydney AUDUSD Session", "Tokyo USDJPY Session", "Wellington NZDUSD
 * Session" — carry the window value `asian`, which is a TRADING CLOCK
 * (19:00–04:00 ET). Read as a clock, they are shut through London and the whole
 * US session. Measured at 12:44 UTC: AUDUSD scored 100% STRONG_BUY with zero
 * pre-trade blockers, `preTradeReady: true`, and produced no order — while the
 * app reported nothing, because session skips are deduped to a single log line
 * that had long since scrolled away.
 *
 * ⚠️ The window VALUE cannot be the thing that is wrong. Verified against the
 * live table: those bots store the literal `asian`, not `sydney`. By the time it
 * is a column value the decision looks deliberate. The ambiguity lives in the
 * NAME — those cities name the place whose NEWS drives the pair (AUD news is
 * Sydney, JPY news is Tokyo, NZD news is Wellington), and the same word is also a
 * trading session. Nothing in the data says which reading was meant.
 *
 * So this file pins three separate things:
 *
 *   1. The CLOCK behaviour is unchanged and still correct. A city alias still
 *      resolves; the tag still gates by time. Silently un-gating three bots would
 *      be a trading behaviour change dressed as a bug fix.
 *   2. The AMBIGUITY is REPORTED. `auditNameVsWindow` says whether the name and
 *      the window agree, disagree, or are consistent with two readings — so the
 *      question reaches the operator instead of being answered by a keyword.
 *   3. The audit NEVER changes a gate. Asserted directly, because it is the one
 *      property that makes it safe to add.
 *
 * A test asserting only "the gate returns ok/not-ok" would have passed before
 * this change and passes after it — which is why the assertions are on the audit
 * and on clock behaviour being preserved.
 */

import {
  checkSessionWindow,
  auditNameVsWindow,
  isSessionOpen,
  parseSessionWindow,
  getActiveSessions,
  toEtMinutes,
  parseExitBoundary,
  checkExitBoundary,
  describeExitBoundary,
} from './session-window';

/** 2026-09-10 12:44 UTC = 08:44 ET — London open, Asian shut. The traced instant. */
const LONDON_OPEN_ASIAN_SHUT = new Date(Date.UTC(2026, 8, 10, 12, 44, 0));
/** 2026-09-10 01:00 UTC = 21:00 ET — Asian open. */
const ASIAN_OPEN = new Date(Date.UTC(2026, 8, 10, 1, 0, 0));

describe('session-window — clock behaviour is preserved (#759)', () => {
  it('resolves the aliases the seeded bots use, unchanged', () => {
    // These must keep working. Removing them would silently UN-gate the bots.
    expect(parseSessionWindow('asian')).toEqual(['asian']);
    expect(parseSessionWindow('sydney')).toEqual(['asian']);
    expect(parseSessionWindow('tokyo')).toEqual(['asian']);
    expect(parseSessionWindow('wellington')).toEqual(['asian']);
    expect(parseSessionWindow('zurich')).toEqual(['london']);
  });

  it('gates by the clock, exactly as before', () => {
    expect(checkSessionWindow('asian', LONDON_OPEN_ASIAN_SHUT).ok).toBe(false);
    expect(checkSessionWindow('asian', ASIAN_OPEN).ok).toBe(true);
    expect(checkSessionWindow('london', LONDON_OPEN_ASIAN_SHUT).ok).toBe(true);
  });

  it('leaves an ungated bot ungated — the gate stays opt-in', () => {
    for (const raw of [null, undefined, '', '   ', 'always', 'any', 'none']) {
      expect(checkSessionWindow(raw, LONDON_OPEN_ASIAN_SHUT).ok).toBe(true);
    }
  });

  it('reports London as the only open session at the traced instant', () => {
    expect(getActiveSessions(LONDON_OPEN_ASIAN_SHUT)).toEqual(['london']);
    // 12:44 UTC with DST (month 8 = Sep) → 08:44 ET = 524 minutes.
    expect(toEtMinutes(LONDON_OPEN_ASIAN_SHUT)).toBe(8 * 60 + 44);
  });

  it('keeps the overnight wrap correct for the Asian session', () => {
    // Asian is 19:00–04:00 ET and wraps past midnight.
    expect(isSessionOpen('asian', new Date(Date.UTC(2026, 8, 10, 1, 0, 0)))).toBe(true);   // 21:00 ET — inside
    expect(isSessionOpen('asian', new Date(Date.UTC(2026, 8, 10, 7, 0, 0)))).toBe(true);   // 03:00 ET — still inside
    // The wrap must END at 04:00 ET, not run all day.
    expect(isSessionOpen('asian', new Date(Date.UTC(2026, 8, 10, 12, 0, 0)))).toBe(false); // 08:00 ET — outside
    // ...and RE-OPEN the same evening (19:00 ET = 23:00 UTC).
    expect(isSessionOpen('asian', new Date(Date.UTC(2026, 8, 10, 23, 0, 0)))).toBe(true);
  });

  it('never throws on a corrupt window — a bad value means UNGATED', () => {
    for (const bad of [undefined, null, '', '   ', '[]', 'not-a-session', 42, {}]) {
      expect(() => checkSessionWindow(bad, LONDON_OPEN_ASIAN_SHUT)).not.toThrow();
      expect(checkSessionWindow(bad, LONDON_OPEN_ASIAN_SHUT).ok).toBe(true);
    }
  });
});

describe('auditNameVsWindow — the name/window ambiguity is REPORTED (#759)', () => {
  it('flags the three seeded forex bots as ambiguous', () => {
    // The exact pairs from the live table: city NAME, `asian` WINDOW. If this
    // stops flagging, the fault becomes invisible again.
    const bots: Array<[string, string]> = [
      ['Sydney AUDUSD Session', 'asian'],
      ['Tokyo USDJPY Session', 'asian'],
      ['Wellington NZDUSD Session', 'asian'],
    ];
    for (const [name, win] of bots) {
      const a = auditNameVsWindow(name, win);
      expect(a.agreement).toBe('ambiguous');
      expect(a.cityWord).not.toBeNull();
      expect(a.windowTags).toEqual(['asian']);
      // The note must carry BOTH readings, because that is the whole point:
      // the operator is being asked which one they meant.
      expect(a.note).toMatch(/clock/);
      expect(a.note).toMatch(/news/);
    }
  });

  it('reports a session-word NAME that contradicts its window', () => {
    // "London …" with a `us` window is not ambiguous, it is wrong. A different
    // verdict, so the operator can tell "decide what I meant" from "this is a bug".
    const a = auditNameVsWindow('London EURGBP Session', 'us');
    expect(a.agreement).toBe('contradictory');
    expect(a.sessionWord).toBe('london');
    expect(a.note).toMatch(/name says "london" but the window declares us/);
  });

  it('reports a city name with NO window as ungated, not ambiguous', () => {
    // A city name alone is not a fault — the bot simply has no clock. Saying
    // "ambiguous" here would cry wolf on every city-named bot in the list.
    const a = auditNameVsWindow('Tokyo USDJPY Session', null);
    expect(a.agreement).toBe('consistent');
    expect(a.cityWord).toBe('tokyo');
    expect(a.note).toMatch(/UNGATED/);
  });

  it('treats a city word as ambiguous even when it matches the window', () => {
    // Zurich IS a city word and `london` IS what its alias resolves to — still
    // ambiguous, because the name does not distinguish clock from news flow.
    const b = auditNameVsWindow('Zurich USDCHF Session', 'london');
    expect(b.agreement).toBe('ambiguous');
    expect(b.cityWord).toBe('zurich');
  });

  it('passes a plain descriptive name', () => {
    const a = auditNameVsWindow('GBPUSD Session', null);
    expect(a.agreement).toBe('consistent');
    expect(a.cityWord).toBeNull();
  });

  it('reads a JSON-array window the same way as a bare string', () => {
    // The column is written by humans and by seeds, in both shapes.
    expect(auditNameVsWindow('Tokyo USDJPY Session', ['asian']).agreement).toBe('ambiguous');
    expect(auditNameVsWindow('Tokyo USDJPY Session', '["asian"]').agreement).toBe('ambiguous');
    expect(parseSessionWindow('["asian"]')).toEqual(['asian']);
  });

  it('does not throw on a missing or malformed name', () => {
    for (const bad of [undefined, null, '', 42, {}, []]) {
      expect(() => auditNameVsWindow(bad as unknown, 'asian')).not.toThrow();
    }
  });
});

describe('auditNameVsWindow — it must NEVER change a gate (#759)', () => {
  it('returns identical gate decisions for an ambiguous and a plain name', () => {
    // The safety property that makes adding the audit acceptable. If this ever
    // fails, the audit has started making trading decisions — which is exactly
    // what it must not do, because it cannot know what the operator meant.
    const ats = [LONDON_OPEN_ASIAN_SHUT, ASIAN_OPEN];
    const windows = ['asian', 'london', 'us', null];

    for (const at of ats) {
      for (const win of windows) {
        const before = checkSessionWindow(win, at);
        // Calling the audit must not mutate anything the gate observes.
        auditNameVsWindow('Sydney AUDUSD Session', win);
        auditNameVsWindow('GBPUSD Session', win);
        const after = checkSessionWindow(win, at);

        expect(after.ok).toBe(before.ok);
        expect(after.allowed).toEqual(before.allowed);
        expect(after.active).toEqual(before.active);
        expect(after.reason).toBe(before.reason);
      }
    }
  });

  it('keeps the skip REASON free of audit commentary', () => {
    // The reason is consumed by the queue-blocker text and the UI. The audit is
    // reported on its own field so the two can never be confused for one another.
    const r = checkSessionWindow('asian', LONDON_OPEN_ASIAN_SHUT);
    expect(r.reason).toBe('outside Asian session (open: London)');
    expect(r.reason).not.toMatch(/news|city|ambiguous/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #928 — THE EXIT-SIDE BOUNDARY. Same axis, opposite end of the trade.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('session-window — the exit boundary is OPT-IN (#928)', () => {
  it('declines to act when no boundary is declared — the pre-existing behaviour', () => {
    // This is the contract that lets the feature ship without touching a single existing bot.
    for (const raw of [null, undefined, '']) {
      const r = checkExitBoundary(raw, LONDON_OPEN_ASIAN_SHUT);
      expect(r.due).toBe(false);
      expect(r.status).toBe('none');
    }
  });

  it('is NOT due before the boundary', () => {
    const r = checkExitBoundary('13:30', new Date(Date.UTC(2026, 8, 10, 12, 44, 0)));
    expect(r.due).toBe(false);
    expect(r.status).toBe('before');
    expect(r.boundaryMin).toBe(810);
  });

  it('IS due at the boundary minute exactly (inclusive)', () => {
    const r = checkExitBoundary('13:30', new Date(Date.UTC(2026, 8, 10, 13, 30, 0)));
    expect(r.due).toBe(true);
    expect(r.status).toBe('reached');
    expect(r.reason).toMatch(/13:30 UTC/);
  });

  it('stays due after the boundary — the rule is stateless and idempotent', () => {
    // A crossing-edge rule would need the entry time and would stop being due after a restart.
    const late = checkExitBoundary('13:30', new Date(Date.UTC(2026, 8, 10, 23, 59, 0)));
    expect(late.due).toBe(true);
  });

  it('is due immediately for a boundary that has already passed today', () => {
    const r = checkExitBoundary('00:05', new Date(Date.UTC(2026, 8, 10, 12, 44, 0)));
    expect(r.due).toBe(true);
  });

  it('compares in UTC, not local time', () => {
    // 13:30Z must be the boundary whatever the host offset. A local-time bug would shift it by hours
    // and would still look plausible in every other test here.
    expect(checkExitBoundary('13:30', new Date(Date.UTC(2026, 8, 10, 13, 29, 0))).due).toBe(false);
    expect(checkExitBoundary('13:30', new Date(Date.UTC(2026, 8, 10, 13, 31, 0))).due).toBe(true);
  });

  it('⚠️ DOES NOT CLOSE ON A TYPO — an unreadable boundary is invalid, not "none"', () => {
    for (const bad of ['1330', '25:00', '13:60', 'half one', '13:3']) {
      const r = checkExitBoundary(bad, LONDON_OPEN_ASIAN_SHUT);
      expect(r.due).toBe(false);
      expect(r.status).toBe('invalid');
      expect(r.reason).toMatch(/not HH:MM/);
    }
  });

  it('tells "absent" and "unreadable" apart, so a typo is never silent', () => {
    expect(parseExitBoundary(null)).toEqual({ kind: 'none' });
    expect(parseExitBoundary('')).toEqual({ kind: 'none' });
    expect(parseExitBoundary('1330')).toEqual({ kind: 'invalid', raw: '1330' });
    expect(parseExitBoundary('13:30')).toEqual({ kind: 'at', minutes: 810 });
  });

  it('accepts both digits of a single-digit hour', () => {
    expect(parseExitBoundary('09:05')).toEqual({ kind: 'at', minutes: 545 });
    expect(parseExitBoundary('9:05')).toEqual({ kind: 'at', minutes: 545 });
  });

  it('describes itself for the UI without inventing a boundary', () => {
    expect(describeExitBoundary(null)).toBe('holds through any time');
    expect(describeExitBoundary('13:30')).toBe('flat by 13:30 UTC');
    expect(describeExitBoundary('nonsense')).toMatch(/UNREADABLE/);
  });
});
