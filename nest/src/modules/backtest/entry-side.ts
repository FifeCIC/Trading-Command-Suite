/**
 * entry-side.ts — WHICH SIDE A SIGNAL OPENS, as a pure decision.
 *
 * ⚠️ EXTRACTED FROM THE TRADE LOOP ON 2026-10-31 SO IT CAN BE TESTED AT ALL. The decision lived
 * inline in `run()` — behind Prisma, a bar loader and a scoring call — so the newest money-path code
 * in the repo had no assertion (register row 104 records it as 🔴 UNGUARDED). Extracting it costs
 * nothing and makes the one thing that can flip a trade's direction checkable.
 *
 * ── THE TRAP THIS EXISTS FOR ───────────────────────────────────────────────────────────────────
 * The obvious implementation is `signal.includes('SELL')`, or worse `signal.startsWith('SELL')`. The
 * repo has this exact defect recorded: **`'STRONG_SELL'.startsWith('SELL') === false`**, so a prefix
 * test routed the STRONGEST sell signal to the LONG branch — a plausible number with no error, on
 * the strongest signal in the system. The four classes are therefore enumerated, never matched by
 * substring, and `entry-side.spec.ts` fails if that changes.
 *
 * ── AND THE SIGN THAT MUST NOT BE GUESSED ─────────────────────────────────────────────────────
 * `side` is +1 for long and −1 for short, and it multiplies BOTH the cost function and the P&L. A
 * wrong sign does not throw: it books every short with a long's P&L, so a "shorting VIX is better"
 * conclusion would be an artefact of a sign. `side` is derived here, once, and returned with the
 * decision so no caller can re-derive it differently.
 */

export type DirectionMode = 'long' | 'short' | 'both';

/** The four signal classes the gating pipeline emits. Enumerated, never substring-matched. */
export const LONG_SIGNALS = ['BUY', 'STRONG_BUY'] as const;
export const SHORT_SIGNALS = ['SELL', 'STRONG_SELL'] as const;

export interface EntryDecision {
  /** TRUE when this bar opens a position. */
  enter: boolean;
  /** TRUE for a long. Meaningless when `enter` is false — read `side` only after checking. */
  isLong: boolean;
  /** +1 long, −1 short. Multiplies the cost function and the P&L. */
  side: 1 | -1;
  /** Why it did not enter, when it did not — named so a caller can log it rather than guess. */
  blockedBy: 'no-signal' | 'direction-mode' | null;
}

/**
 * @param signal        the bar's signal class. An unknown value is treated as no signal, never as a
 *                      long — "I don't recognise this" must not become "buy".
 * @param directionMode which sides the run is allowed to open.
 */
export function decideEntry(signal: string, directionMode: DirectionMode): EntryDecision {
  const isLongSignal = (LONG_SIGNALS as readonly string[]).includes(signal);
  const isShortSignal = (SHORT_SIGNALS as readonly string[]).includes(signal);

  // ⚠️ AN UNRECOGNISED SIGNAL IS NOT A BUY. Falling back to long would make a renamed or misspelt
  // class silently trade the wrong way; refusing is the only safe default.
  if (!isLongSignal && !isShortSignal) {
    return { enter: false, isLong: false, side: 1, blockedBy: 'no-signal' };
  }

  const mayGoLong = directionMode === 'long' || directionMode === 'both';
  const mayGoShort = directionMode === 'short' || directionMode === 'both';

  if (isLongSignal && !mayGoLong) return { enter: false, isLong: false, side: 1, blockedBy: 'direction-mode' };
  if (isShortSignal && !mayGoShort) return { enter: false, isLong: false, side: 1, blockedBy: 'direction-mode' };

  const isLong = isLongSignal;
  return { enter: true, isLong, side: isLong ? 1 : -1, blockedBy: null };
}
