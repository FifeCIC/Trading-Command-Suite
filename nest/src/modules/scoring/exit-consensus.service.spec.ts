/**
 * #1020 — the exit-verdict rule, and the mistake it must not repeat.
 *
 * ⚠️ WHY THIS SPEC EXISTS AT ALL. The rule was inline in a private method of the service, so the
 * defect it now fixes had NO test, and the two directives it silently muted were invisible for as
 * long as they existed. A rule that cannot be called cannot be canaried. Extracting `arguesExitFor()`
 * is what made these assertions possible.
 */
import { arguesExitFor } from './exit-consensus.service';

describe('arguesExitFor (#1020)', () => {
  describe('directional — unchanged, and it must STAY unchanged', () => {
    it('a bearish claim argues an exit on a LONG', () => {
      expect(arguesExitFor('buy', 'bearish', 10)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a bearish claim does NOT argue an exit on a SHORT', () => {
      expect(arguesExitFor('sell', 'bearish', 10)).toEqual({ arguesExit: false, via: null });
    });

    it('a bullish claim argues an exit on a SHORT', () => {
      expect(arguesExitFor('sell', 'bullish', 10)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a neutral class argues nothing when no threshold is declared', () => {
      // This is the pre-#1020 behaviour, and it is CORRECT for a directive with no authority.
      expect(arguesExitFor('buy', 'neutral', 100)).toEqual({ arguesExit: false, via: null });
    });
  });

  describe('side-agnostic — the path #1020 adds', () => {
    it('a score AT the declared threshold argues an exit, for a LONG', () => {
      expect(arguesExitFor('buy', 'neutral', 70, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });

    it('...and for a SHORT — being side-agnostic is the whole point', () => {
      expect(arguesExitFor('sell', 'neutral', 70, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });

    it('one point below does NOT argue — the boundary is inclusive, so it is named here', () => {
      expect(arguesExitFor('buy', 'neutral', 69.99, 70)).toEqual({ arguesExit: false, via: null });
    });

    it('regime-shift-exit is the case this exists for: neutral class, score 100, reason "Exit recommended"', () => {
      // Measured live 2026-09-29: this directive reached score 100 with an explicit "Exit
      // recommended." reason while `arguesExit` was false on every one of 17 open positions.
      expect(arguesExitFor('buy', 'neutral', 100, 70)).toEqual({ arguesExit: true, via: 'threshold' });
    });
  });

  describe('THE REGRESSION THIS MUST NEVER REPEAT', () => {
    // ⚠️ THE FIRST DESIGN keyed on `directionBias === 'neutral'` to mean "read the score instead of
    // the class". That would have SILENTLY DISABLED `chandelier-exit` — it declares neutral bias
    // while emitting real bullish/bearish classes and arguing 6 exits on live data.
    //
    // `directive.interface.ts` already documented why: "a `neutral` directionBias is valid for a
    // dynamic TWO-SIDED directive." Reading the declarations is what caught it, before it shipped.
    //
    // The structural guard is the function's SIGNATURE — it takes no `directionBias`, so there is
    // nothing to re-key on. These tests pin the behaviour that would have been lost.
    it('a directional claim still wins for a directive that ALSO declares a threshold', () => {
      // chandelier-exit's live shape: neutral bias, real bearish class, threshold irrelevant.
      expect(arguesExitFor('buy', 'bearish', 50, 70)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('direction is reported when BOTH would argue — the more specific claim wins', () => {
      expect(arguesExitFor('buy', 'bearish', 90, 70)).toEqual({ arguesExit: true, via: 'direction' });
    });

    it('a neutral class with a threshold NOT met still argues nothing', () => {
      expect(arguesExitFor('sell', 'neutral', 12, 70)).toEqual({ arguesExit: false, via: null });
    });

    it('an UNDECLARED threshold grants NO authority — time-stop\'s deliberate state', () => {
      // time-stop cannot see position age (its own comment: "needs position open time which isn't in
      // bars"), so declaring a threshold would put a second momentum signal into the verdict under a
      // name claiming otherwise. A real time stop already exists:
      // position-time-stop.service.ts / closeReason 'system:time-stop' — 46 rows measured.
      expect(arguesExitFor('buy', 'neutral', 80, undefined)).toEqual({ arguesExit: false, via: null });
    });
  });
});
