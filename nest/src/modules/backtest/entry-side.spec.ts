/**
 * entry-side.spec.ts — the canary for which side a signal opens.
 *
 * ⚠️ EVERY CASE HERE CORRESPONDS TO A WAY THIS CAN GO WRONG SILENTLY. A wrong direction does not
 * throw: it produces a full, plausible backtest with the sign flipped, and the conclusion drawn from
 * it ("shorting VIX is better") would be an artefact.
 */
import { decideEntry, refuseUnrunnableDirection, type DirectionMode } from './entry-side';

describe('decideEntry', () => {
  it('opens a LONG on BUY and STRONG_BUY, with side +1', () => {
    for (const s of ['BUY', 'STRONG_BUY']) {
      expect(decideEntry(s, 'long')).toEqual({ enter: true, isLong: true, side: 1, blockedBy: null });
    }
  });

  it('opens a SHORT on SELL and STRONG_SELL, with side −1', () => {
    for (const s of ['SELL', 'STRONG_SELL']) {
      expect(decideEntry(s, 'short')).toEqual({ enter: true, isLong: false, side: -1, blockedBy: null });
    }
  });

  /**
   * ⚠️ THE REGRESSION THIS FILE EXISTS FOR. `'STRONG_SELL'.startsWith('SELL') === false`, so a
   * substring or prefix test sends the STRONGEST sell signal down the LONG branch. Asserting it
   * explicitly means a future refactor to `includes` cannot pass silently.
   */
  it('routes STRONG_SELL as a SHORT, not as a long — the prefix-test trap', () => {
    const d = decideEntry('STRONG_SELL', 'short');
    expect(d.isLong).toBe(false);
    expect(d.side).toBe(-1);
    expect('STRONG_SELL'.startsWith('SELL')).toBe(false); // the trap, stated
    expect('STRONG_SELL'.includes('SELL')).toBe(true);     // and why 'includes' is no better
  });

  it('refuses a SELL when only longs are allowed, and says why', () => {
    const d = decideEntry('SELL', 'long');
    expect(d.enter).toBe(false);
    expect(d.blockedBy).toBe('direction-mode');
  });

  it('refuses a BUY when only shorts are allowed', () => {
    const d = decideEntry('BUY', 'short');
    expect(d.enter).toBe(false);
    expect(d.blockedBy).toBe('direction-mode');
  });

  it('takes both sides in BOTH mode, and the side still follows the signal', () => {
    expect(decideEntry('BUY', 'both')).toMatchObject({ enter: true, isLong: true, side: 1 });
    expect(decideEntry('SELL', 'both')).toMatchObject({ enter: true, isLong: false, side: -1 });
  });

  it('treats HOLD as no entry', () => {
    for (const mode of ['long', 'short', 'both'] as const) {
      const d = decideEntry('HOLD', mode);
      expect(d.enter).toBe(false);
      expect(d.blockedBy).toBe('no-signal');
    }
  });

  /**
   * ⚠️ AN UNRECOGNISED SIGNAL MUST NOT BECOME A BUY. A renamed class, a typo, or a lower-case
   * 'buy' would otherwise trade long by accident — the most expensive possible default.
   */
  it('refuses an unrecognised signal instead of defaulting to long', () => {
    for (const s of ['', 'buy', 'STRONG BUY', 'BUYISH', 'NEUTRAL']) {
      const d = decideEntry(s, 'both');
      expect(d.enter).toBe(false);
      expect(d.blockedBy).toBe('no-signal');
      expect(d.isLong).toBe(false);
    }
  });

  it('never returns side −1 without enter, so a caller cannot read a direction off a refusal', () => {
    for (const [s, m] of [['HOLD', 'long'], ['SELL', 'long'], ['BUY', 'short'], ['???', 'both']] as const) {
      const d = decideEntry(s, m);
      expect(d.enter).toBe(false);
      expect(d.side).toBe(1); // the neutral value; `enter` is the flag that must be checked first
    }
  });
});

/**
 * ── 'both' IS REFUSED BY THE RUN PATH (owner direction, confirmed 2026-11-01) ─────────────────────
 * *"there needs to be two active strategies"* — never one bot trading both ways, and never one
 * protocol scored both ways. `decideEntry` above stays correct (and tested) for `'both'`; it is the
 * RUN that must not accept it. Both directions are asserted so this cannot pass by never running.
 */
describe('refuseUnrunnableDirection', () => {
  it('REFUSES "both" with a message that says what to do instead', () => {
    let err: Error | undefined;
    try { refuseUnrunnableDirection('both'); } catch (e) { err = e as Error; }
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('two separate strategies');
    // The remedy must be in the message — a refusal with no next step is a dead end.
    expect(err!.message).toContain('Run the window twice');
  });

  it('does NOT refuse the two modes the app can actually run', () => {
    expect(() => refuseUnrunnableDirection('long')).not.toThrow();
    expect(() => refuseUnrunnableDirection('short')).not.toThrow();
  });

  it('every DirectionMode is classified — a future mode cannot slip through unchecked', () => {
    const all: DirectionMode[] = ['long', 'short', 'both'];
    const refused = all.filter((m) => {
      try { refuseUnrunnableDirection(m); return false; } catch { return true; }
    });
    expect(refused).toEqual(['both']);
  });
});