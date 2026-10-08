/**
 * botWindowState() — per-bot session state for the status surface (#981).
 *
 * ⚠️ THE TEST THAT MATTERS MOST IS `THE DEAD-PATH PROOF`. The defect #981 names was structural, not
 * a wrong value: `auditNameVsWindow()` was called ONLY from `logSessionSkip()`, which is only
 * reached when `checkSessionWindow()` returns a skip — and a NULL window is UNGATED, so it never
 * skips and the audit never ran for exactly the bots it was written for. The first two tests pin
 * both halves: the new per-tick record exists for a NULL bot, AND the old single call site was
 * unreachable for it.
 *
 * Canary (observed 2026-10-08, both directions): reverting the ungated branch fails the first test;
 * embedding the minute count in the alert title fails the collapse-stability test in the sibling
 * spec; restore → 13/13 green with `git diff` showing additions only. The #982 canary (set one SEED
 * entry to NULL → `strategy-seed-session-declared.spec.ts` fails, naming the bot — **`tsc` stays
 * green, strictNullChecks is off**) is recorded on #982.
 */
import { botWindowState, checkSessionWindow } from './session-window';

describe('botWindowState — every active bot gets a distinct session reading (#981)', () => {
  // Thursday 2026-10-08 12:00 UTC = 08:00 ET. London clock (03:00-12:00 ET) is OPEN; the US clock
  // (09:30-16:00 ET) is SHUT. One instant, two declared windows, opposite verdicts.
  const AT = new Date('2026-10-08T12:00:00Z');

  it('records an UNFILLED bot with a NULL window — the case the audit could never see', () => {
    const state = botWindowState(
      { id: 'b1', name: 'Sydney AUDJPY Session', symbol: 'AUDJPY', sessionWindow: null },
      AT,
    );
    expect(state.strategyId).toBe('b1');
    expect(state.gated).toBe(false);
    expect(state.slotKind).toBe('unfilled');
    expect(state.declared).toBe(false);
    expect(state.reason).toMatch(/undecided — the session slot was never filled/);
    expect(state.allowed).toEqual([]);
    // The name-vs-window audit note must SAY it is ungated — "the audit found nothing" and "the
    // slot is empty" are different readings and both must be visible.
    expect(state.nameWindowNote.toLowerCase()).toContain('ungated');
  });

  it('records a DECLARED all-hours bot distinctly from an unfilled one (#982)', () => {
    const state = botWindowState(
      { id: 'b1b', name: 'Gold Swing 1H', symbol: 'XAUUSD', sessionWindow: 'all-hours' },
      AT,
    );
    expect(state.gated).toBe(false);          // identical GATE behaviour…
    expect(state.slotKind).toBe('all-hours');
    expect(state.declared).toBe(true);        // …but a different, VISIBLE reading
    expect(state.reason).toMatch(/all-hours \(declared bypass\)/);
  });

  it('records an UNREADABLE value as its own state — never silently as all-hours', () => {
    const state = botWindowState({ id: 'b1c', name: 'X', sessionWindow: 'wibble' }, AT);
    expect(state.slotKind).toBe('unreadable');
    expect(state.declared).toBe(true);
    expect(state.reason).toMatch(/unreadable session window/);
  });

  it('THE DEAD-PATH PROOF — a NULL window never skips, which is why logSessionSkip() never ran the audit for these bots', () => {
    const sess = checkSessionWindow(null, AT);
    expect(sess.ok).toBe(true);            // ungated → the gate passes…
    expect(sess.reason).toBeUndefined();   // …so no skip was ever logged, so the one audit call site was unreachable
    // The new per-tick path records the bot ANYWAY — that is the fix.
    const state = botWindowState({ id: 'b1', name: 'Sydney AUDJPY Session', sessionWindow: null }, AT);
    expect(state.strategyId).toBe('b1');
  });

  it('records a DECLARED window that is currently SHUT as gated, with the ready-to-log reason', () => {
    const state = botWindowState(
      { id: 'b2', name: 'London EURGBP Session', symbol: 'EURGBP', sessionWindow: 'us' },
      AT,
    );
    expect(state.gated).toBe(true);
    expect(state.allowed).toEqual(['us']);
    expect(state.reason).toMatch(/^outside .*session \(open:/);
  });

  it('records a DECLARED window that is currently OPEN as not gated, naming the open tag', () => {
    const state = botWindowState(
      { id: 'b3', name: 'London EURGBP Session', symbol: 'EURGBP', sessionWindow: 'london' },
      AT,
    );
    expect(state.gated).toBe(false);
    expect(state.reason).toBe('within window (london)');
    expect(state.active).toContain('london');
  });

  it('keeps FIVE readings distinct — unfilled ≠ all-hours ≠ unreadable ≠ open ≠ shut', () => {
    const unfilled = botWindowState({ id: 'a', name: 'X', sessionWindow: null }, AT).slotKind;
    const allHours = botWindowState({ id: 'b', name: 'X', sessionWindow: 'all-hours' }, AT).slotKind;
    const unreadable = botWindowState({ id: 'c', name: 'X', sessionWindow: 'nonsense-window' }, AT).slotKind;
    const open = botWindowState({ id: 'd', name: 'X', sessionWindow: 'london' }, AT).reason;
    const shut = botWindowState({ id: 'e', name: 'X', sessionWindow: 'us' }, AT).reason;
    expect(new Set([unfilled, allHours, unreadable]).size).toBe(3);
    expect(open).not.toBe(shut);
  });

  it('stamps `at` so a stale record (loop stopped) is visible as stale', () => {
    const state = botWindowState({ id: 'b4', name: 'X' }, AT);
    expect(state.at).toBe('2026-10-08T12:00:00.000Z');
  });
});
