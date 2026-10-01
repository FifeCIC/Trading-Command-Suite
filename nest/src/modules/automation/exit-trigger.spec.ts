/**
 * exit-trigger.spec.ts — proves the exit decision can FAIL, in both directions (#928).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARD IS FOR
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Every case below is a way the exit path was, or could become, silently wrong. The signature this
 * repo keeps re-finding is **plausible behaviour with no error** — a position that is not closed
 * looks exactly like a position that should not be closed, and nothing throws.
 *
 * ⚠️ A guard that has never been observed to fail is a decoration, so each risk has a POSITIVE case
 * (the thing that must happen) and, where the risk is masking, a NEGATIVE one too.
 *
 * ⚠️ THE CLOCK IS ALWAYS PINNED. `at` is passed explicitly rather than left to `new Date()`. A test
 * that depends on the wall clock passes for the wrong reason at 11:00 and fails at 14:00, and this
 * exact class of mistake (`a warm-up call hides the regression you are measuring`) is called out in
 * the development philosophy.
 */
import { decideExitTrigger, hasAnyExitRule } from './exit-trigger';

/** UTC clock helper — `new Date('...Z')` is unambiguous, local-time strings are not. */
const at = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00.000Z`);

describe('decideExitTrigger — #928 exit-side session boundary', () => {
  describe('the OPT-IN contract: nothing changes for a bot that declares nothing', () => {
    it('no hold limit, no boundary → never due', () => {
      const d = decideExitTrigger({ maxHoldHours: null, hoursHeld: 500, exitBeforeUtc: null });
      expect(d.due).toBe(false);
      expect(d.trigger).toBeNull();
      expect(d.boundary.status).toBe('none');
    });

    it('an EMPTY STRING is treated as no boundary, like NULL (both mean "ungated")', () => {
      const d = decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: '   ' });
      expect(d.boundary.status).toBe('none');
      expect(d.due).toBe(false);
    });
  });

  describe('🛑 the MASKING risk — the defect extraction exists to prevent', () => {
    /**
     * The original loop `continue`d the instant `maxHoldHours` was null. A boundary-only bot would
     * then have had an ARMED, VISIBLE gate in the UI that could never fire. This is the canary for
     * that shape, and it is the single most important case in this file.
     */
    it('a BOUNDARY-ONLY bot (maxHoldHours null) still fires when past its boundary', () => {
      const d = decideExitTrigger({
        maxHoldHours: null,
        hoursHeld: 2,
        exitBeforeUtc: '13:30',
        at: at('14:00'),
      });
      expect(d.overMaxHold).toBe(false);
      expect(d.due).toBe(true);
      expect(d.trigger).toBe('exit_boundary');
      // and it must not fabricate an "over by" figure for a limit that is not declared
      expect(d.overByHours).toBe(0);
    });

    it('a HOLD-LIMIT-ONLY bot is unaffected by the boundary being absent', () => {
      const d = decideExitTrigger({
        maxHoldHours: 4,
        hoursHeld: 9,
        exitBeforeUtc: null,
        at: at('14:00'),
      });
      expect(d.due).toBe(true);
      expect(d.trigger).toBe('max_hold');
      expect(d.overByHours).toBe(5);
    });
  });

  describe('attribution when BOTH are due — the counterfactual replay depends on this', () => {
    it('names max_hold, because the position aged out rather than the clock moving past', () => {
      const d = decideExitTrigger({
        maxHoldHours: 1,
        hoursHeld: 30,
        exitBeforeUtc: '13:30',
        at: at('23:00'),
      });
      expect(d.due).toBe(true);
      expect(d.trigger).toBe('max_hold');
      // ⚠️ `overMaxHold` is still reported true, so the caller can log both facts rather than
      // losing the boundary observation just because it did not name the close.
      expect(d.overMaxHold).toBe(true);
    });
  });

  describe('the boundary comparison itself', () => {
    it('is INCLUSIVE at the boundary minute — 13:30 is PAST 13:30, not before it', () => {
      expect(decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: '13:30', at: at('13:30') }).due)
        .toBe(true);
    });

    it('one minute before is NOT due', () => {
      expect(decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: '13:30', at: at('13:29') }).due)
        .toBe(false);
    });

    it('is STATELESS — being well past it is due, so a restart mid-window still closes', () => {
      // The rule is "past the boundary", not "crossing it". A crossing-edge rule would stop being
      // due after a restart, i.e. it would silently change its mind.
      expect(decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: '13:30', at: at('23:59') }).due)
        .toBe(true);
    });

    it('does not close BEFORE the boundary merely because the hour rolled over', () => {
      // 00:10 UTC is "past midnight", which is later than the previous line's 23:59 — a naive
      // minutes-past-midnight comparison is right here, and this pins it rather than assuming.
      expect(decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: '13:30', at: at('00:10') }).due)
        .toBe(false);
    });
  });

  describe('🛑 an UNREADABLE boundary must never close a position', () => {
    /**
     * The worst possible failure of this feature: a typo in a field flattens a live position.
     * `status: 'invalid'` therefore must NOT be folded into `none` (which would silently discard
     * the operator's declared rule) nor into `due` (which would act on a value nobody can read).
     */
    it.each([['13:3'], ['1:300'], ['25:00'], ['13:60'], ['half past one'], ['13.30']])(
      'rejects %s — no close, and the status is reported as invalid',
      (raw) => {
        const d = decideExitTrigger({ maxHoldHours: null, hoursHeld: 1, exitBeforeUtc: raw, at: at('23:00') });
        expect(d.due).toBe(false);
        expect(d.trigger).toBeNull();
        // NOT 'none': the difference is "nothing declared" versus "declared but unreadable", and
        // only the second one is a fault the operator must be told about.
        expect(d.boundary.status).toBe('invalid');
        expect(d.boundary.reason).toBeTruthy();
      },
    );

    it('an invalid boundary does not suppress a valid hold limit', () => {
      // The dangerous interaction: one broken declaration must not disable the OTHER mechanism.
      const d = decideExitTrigger({ maxHoldHours: 2, hoursHeld: 5, exitBeforeUtc: 'oops', at: at('12:00') });
      expect(d.boundary.status).toBe('invalid');
      expect(d.due).toBe(true);
      expect(d.trigger).toBe('max_hold');
    });
  });

  describe('hasAnyExitRule — "opted out" must not render like "never matched"', () => {
    it('false when neither is declared', () => {
      expect(hasAnyExitRule(null, null)).toBe(false);
      expect(hasAnyExitRule(null, '')).toBe(false);
    });

    it('true when only the boundary is declared', () => {
      expect(hasAnyExitRule(null, '13:30')).toBe(true);
    });

    it('true for an UNREADABLE boundary — it is declared, just broken', () => {
      // Reporting this as "opted out" would hide the fault behind the same word as a deliberate
      // choice, which is the collapse `development-philosophy` §7 forbids.
      expect(hasAnyExitRule(null, 'nonsense')).toBe(true);
    });

    it('true when only the hold limit is declared', () => {
      expect(hasAnyExitRule(4, null)).toBe(true);
    });
  });
});
