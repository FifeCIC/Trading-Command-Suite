/**
 * position-intent.ts — WHAT KIND OF POSITION IS THIS, and therefore what risk applies to it.
 *
 * ⚠️ WHY THIS EXISTS
 * ------------------
 * The `weekend-gap-risk` alert counted **every row in `prisma.position`** and reported, on Friday
 * 2026-09-18:
 *
 *     26 position(s) open going into weekend. Consider flattening or tightening stops.
 *
 * Measured breakdown of those 26:
 *
 *     provider      n    value      pnl
 *     mt5           5    (CFDs)      -30     ← opened today/yesterday; genuine gap risk
 *     trading212   21    23,514     -996     ← opened 25 Jul–1 Aug; long-term holdings
 *
 * Twenty-one of the twenty-six were long-term equity holdings. "Consider flattening" applied to
 * them is not merely unhelpful, it is the opposite of the instruction that should be given — and
 * it fires every Friday, so the alert is trained to be ignored. The defect is not the count; it is
 * that the alert had **no concept of what a position is for**.
 *
 * ⚠️ THE RULE THIS FILE ENCODES
 * -----------------------------
 * A position's RISK is a function of its INTENT, not its size or its sign. A −20% equity holding
 * inside a long-term thesis is a normal intermediate state. A £2 FX position open at 17:00 on a
 * Friday is an unhedged gap risk. Same ledger, different answers — and the difference must be
 * *recorded*, not inferred per-consumer. Before this file, each consumer would have had to invent
 * its own test, which is how the same data yields two different decisions (the "one way to process
 * the same data" rule).
 *
 * ⚠️ DEFAULTS ARE INFERENCE, AND INFERENCE IS LABELLED
 * ----------------------------------------------------
 * Provider defaults below are a *reasonable* reading of what a provider is for, not a fact about
 * any individual position. They are deliberately conservative in the direction that AVOIDS
 * unnecessary action (a stock brokerage position is assumed held), because the cost of wrongly
 * flagging a long-term hold for flattening is a real trade, whereas the cost of wrongly omitting
 * it is a missed advisory alert.
 *
 * Anything the defaults cannot cover is `unclassified` — which is a QUESTION, not an answer. See
 * `needsDecision()`. The app asks; it does not guess silently. (Owner, 2026-09-18: *"if the app
 * itself is missing values it should ask me … It could ask me if I'm happy to hold NVDA Leverage
 * x 3 at a loss and I will say yes."*)
 */

/**
 * What a position is FOR. This is the axis that decides which risk rules apply.
 *
 * - `long-term`     — an investment held through drawdowns by design. Not gap-exposed, and a
 *                     loss is expected to be tolerated. Never advise flattening.
 * - `swing`         — held over multiple days but NOT through a weekend gap by choice.
 * - `intraday`      — opened and closed within a session; holding one over a weekend is an
 *                     accident, not a strategy.
 * - `unclassified`  — the app cannot tell. This is a request for the owner's decision.
 */
export type PositionIntent = 'long-term' | 'swing' | 'intraday' | 'unclassified';

/** Every intent, in display order. Used by validators and the review endpoint. */
export const POSITION_INTENTS: PositionIntent[] = ['long-term', 'swing', 'intraday', 'unclassified'];

/**
 * The intents a WEEKEND GAP actually endangers.
 *
 * ⚠️ `long-term` is deliberately absent. This is the whole point of the file — adding it here
 * would restore the defect (21 equity holdings reported as weekend risk) while looking like a
 * one-word fix.
 */
export const GAP_EXPOSED_INTENTS: PositionIntent[] = ['intraday', 'swing'];

/**
 * What a provider's positions are FOR, in the absence of anything more specific.
 *
 * ⚠️ `mt5` → `intraday` is a default about the ACCOUNT (a CFD margin account), not a claim that
 * every MT5 position is closed daily. A bot holding a multi-day swing is *missed* by this default
 * — accepted, because the alternative default (`unclassified`) would ask about every bot position
 * every day. An explicit override is how a genuine swing gets recorded.
 */
export const PROVIDER_DEFAULT_INTENT: Record<string, PositionIntent> = {
  // A stock brokerage. Positions here are investments; the owner holds through drawdowns.
  // Measured 2026-09-18: 21 positions, oldest opened 25 Jul, aggregate −996 and accepted.
  trading212: 'long-term',
  // A CFD margin account. Positions are trades with a leverage cost, closed same-day or by
  // Friday. Measured 2026-09-18: 5 positions, all opened within 30 hours.
  mt5: 'intraday',
};

/** Anything not in the map above, and not overridden, is unknown — the app asks. */
export const UNKNOWN_PROVIDER_INTENT: PositionIntent = 'unclassified';

/** A position as this module needs to see it — the minimum, so it is trivially testable. */
export interface IntentSubject {
  symbol: string;
  provider: string;
}

/** Resolve the intent for one position: explicit override first, then the provider default. */
export function resolveIntent(
  subject: IntentSubject,
  overrides: ReadonlyMap<string, PositionIntent> = new Map(),
): { intent: PositionIntent; source: 'override' | 'provider-default' | 'unknown' } {
  const key = overrideKey(subject.provider, subject.symbol);
  const override = overrides.get(key);
  if (override) return { intent: override, source: 'override' };

  const fallback = PROVIDER_DEFAULT_INTENT[(subject.provider || '').toLowerCase().trim()];
  if (fallback) return { intent: fallback, source: 'provider-default' };

  return { intent: UNKNOWN_PROVIDER_INTENT, source: 'unknown' };
}

/** The `global_setting` key holding an override. One place, so writer and reader cannot drift. */
export function overrideKey(provider: string, symbol: string): string {
  return `positionIntent.${(provider || '').toLowerCase().trim()}.${(symbol || '').toUpperCase().trim()}`;
}

/** Prefix for every override key — used to enumerate them from the settings store. */
export const OVERRIDE_KEY_PREFIX = 'positionIntent.';

/** True when a weekend gap can hurt this position, i.e. it should count toward the alert. */
export function isGapExposed(intent: PositionIntent): boolean {
  return GAP_EXPOSED_INTENTS.includes(intent);
}

/**
 * True when the owner should be ASKED about this position rather than actioned on it.
 *
 * `unclassified` is the only case today: the app has no basis for a default and no override. It is
 * returned as a question so a surface can present it, rather than defaulting into either answer —
 * defaulting to "gap exposed" would nag, and defaulting to "held" would hide a real risk.
 */
export function needsDecision(intent: PositionIntent): boolean {
  return intent === 'unclassified';
}

/** Human label for a surface. Kept here so every consumer words it identically. */
export function describeIntent(intent: PositionIntent): string {
  switch (intent) {
    case 'long-term': return 'Held long-term (losses tolerated)';
    case 'swing': return 'Swing (must not cross a weekend)';
    case 'intraday': return 'Intraday (closed same session)';
    case 'unclassified': return 'Not classified — needs a decision';
  }
}

/** Parse an unknown value (an API body, a settings row) into an intent, or null. */
export function parseIntent(value: unknown): PositionIntent | null {
  const v = String(value ?? '').toLowerCase().trim();
  return (POSITION_INTENTS as string[]).includes(v) ? (v as PositionIntent) : null;
}

/**
 * Partition positions into the weekend-gap alert's two answers, with the reason for each.
 *
 * Returns the counts AND the members, because the alert message must be able to name what it is
 * warning about — a count with no membership is how "26" became unactionable in the first place.
 */
export function summariseExposure<T extends IntentSubject>(
  positions: readonly T[],
  overrides: ReadonlyMap<string, PositionIntent> = new Map(),
): {
  exposed: Array<T & { intent: PositionIntent }>;
  held: Array<T & { intent: PositionIntent }>;
  needingDecision: Array<T>;
} {
  const exposed: Array<T & { intent: PositionIntent }> = [];
  const held: Array<T & { intent: PositionIntent }> = [];
  const needingDecision: T[] = [];

  for (const p of positions) {
    const { intent } = resolveIntent(p, overrides);
    if (needsDecision(intent)) {
      // Counted as a question, NOT as exposure. Assuming exposure would nag about a position the
      // app cannot characterise; assuming safety would hide a real gap risk. The honest output of
      // "I don't know" is that it is reported as unknown.
      needingDecision.push(p);
      continue;
    }
    if (isGapExposed(intent)) exposed.push({ ...p, intent });
    else held.push({ ...p, intent });
  }

  return { exposed, held, needingDecision };
}
