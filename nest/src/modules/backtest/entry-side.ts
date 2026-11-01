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

/**
 * ── DECISION (2026-11-01, primary) ──
 * WHAT:      `'long'` and `'short'` are TWO ACTIVE STRATEGIES. `'both'` is not a mode of one — it is
 *            refused on the run path, and no surface may offer it.
 * WHY:       A protocol's direction is part of its identity, so a side-flip is a different strategy
 *            with its own protocol, bot and record. `'both'` scores one protocol both ways and trades
 *            one run both ways in the same pass — the two things the architecture forbids.
 * INSTEAD OF: Treating direction as a run setting, which is how `directionMode: 'both'` reached a UI
 *            dropdown. ⚠️ The owner had decided this long before; a search of the register, `docs/`,
 *            the roadmap and the open issue tracker on 2026-11-01 found the rule written down
 *            NOWHERE, so there was nothing for an agent to trip over. That is the real defect this
 *            decision fixes — an unrecorded rule is indistinguishable from no rule.
 * REVERSE BY: Delete `refuseUnrunnableDirection` and its call in `backtest.service.ts`. Nothing is
 *            stored or migrated, so reversal is a pure revert.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 113
 * GUARD:     nest/src/modules/backtest/entry-side.spec.ts
 */

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

/**
 * `'both'` is not a configuration this app can run — refuse it, do not coerce it.
 *
 * ── WHY THIS IS A SEPARATE, PURE FUNCTION ────────────────────────────────────────────────────────
 * Owner direction, confirmed 2026-11-01: *"The decision to not try to score both ways within a single
 * protocol or trade both ways within a single bot was made ages ago: there needs to be two active
 * strategies."* `'both'` does exactly those two forbidden things at once — one protocol's signal,
 * opened long on BUY and short on SELL, inside one run. A result from it describes a configuration
 * that cannot be deployed, which is worse than no result.
 *
 * ⚠️ **Refused, never silently coerced to `'long'`.** Coercion would return a plausible long-only
 * result for a request that asked for something else — the failure shape this repo keeps re-finding.
 *
 * Kept separate from `decideEntry` because that primitive is still correct (and still tested) for
 * `'both'`; it is the RUN PATH that must not accept it. `'both'` remains in the union only so the two
 * stored runs that used it stay readable.
 *
 * Living here rather than in the service means it can be asserted in both directions with no Prisma,
 * no bar loader and no DI — which is why it is a function and not a line inside `run()`.
 */
export function refuseUnrunnableDirection(mode: DirectionMode): void {
  if (mode !== 'both') return;
  throw new Error(
    'directionMode "both" is not a configuration the app can run: long and short are two separate '
    + 'strategies, not one run trading both ways. Run the window twice — once "long", once "short" — '
    + 'and compare the two runs.',
  );
}
