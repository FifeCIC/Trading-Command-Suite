/**
 * signal-threshold-basis.ts — what the BUY / STRONG bar is a PERCENTAGE OF (#1131).
 *
 * ⚠️ THE DEFECT. `ENTRY_THRESHOLD = 6` and `STRONG_PCT = 13` are percentages of the protocol's
 * CONFIGURED directional capacity, which includes directives that can never emit a direction. So the
 * same 13% is a different conviction bar in every protocol:
 *
 *     protocol          configured  earn-able   raw for STRONG   as % of EARN-ABLE
 *     xau-speed-m15          910       630      13% × 910 = 118        18.8%
 *     vix-spike-v1           480       200      13% × 480 =  62        31.2%
 *     forex-session-v1       725       635      13% × 725 =  94        14.8%
 *
 * A protocol carrying a large unearnable share must reach ~31% of everything it could earn to clear
 * a bar another protocol clears at ~15%. The bar is not one bar. That is present today; it needs no
 * change in order to exist.
 *
 * ⚠️⚠️ AND "MOVE THE DIVISOR" IS NOT A SAFER ALTERNATIVE TO "MOVE THE BAR" — THEY ARE THE SAME
 * CONDITION. Written out:
 *
 *     raw / earnable × 100 ≥ 13        (keep the bars, divide by earn-able)
 *     raw / configured × 100 ≥ 13 × earnable/configured   (keep the divisor, scale the bar)
 *
 * are algebraically identical, so any basis correction costs the same frequency change. Measured on
 * 6,183 recorded ticks: both produce **1,157 ticks (19%)** crossing a threshold, protocol for
 * protocol identical. An earlier version of this module claimed the second form was gentler. It is
 * not, and the measurement says so — do not re-introduce that claim.
 *
 * ⚠️ SO 6/13 CANNOT BE CARRIED ACROSS UNCHANGED. 6/13 was never calibrated: it is the 2026-09-15
 * mechanical rescale of 40/80 (÷6.3) onto the post-ADR-011 percentage scale, kept because it made
 * the pipeline produce trades at all. Carrying it onto the earn-able basis therefore means "lower
 * every dirty protocol's bar", not "keep the bar where it was".
 *
 * ⚠️ WHAT THIS MODULE THEREFORE REPORTS. The earn-able bars are CALIBRATED to preserve today's
 * label frequency over the recorded population, then applied per protocol:
 *
 *     EARN_ABLE_BAR = { entry: 7.5, strong: 20 }    (measured 2026-10-21, 6,493 ticks)
 *
 * Reproduces today's rate (4,203 vs 4,154 at-or-above entry; 543 vs 541 STRONG) while making 20% of
 * earn-able capacity mean the same thing in every protocol. Protocols carrying unearnable capacity
 * loosen; protocols carrying none tighten. That redistribution is the entire point — a basis change
 * that leaves every protocol's behaviour alone would be a no-op.
 *
 * ── DECISION (2026-10-21, primary) ──
 * WHAT:      The earn-able basis is COMPUTED AND PERSISTED but NOT USED to label. `THRESHOLD_BASIS`
 *            stays 'configured', so every classification is byte-for-byte what it was.
 * WHY:        This is "the maths". The rule requires a copied configuration and a monitored
 *            comparison, not an in-place edit. Persisting both labels on every tick IS that
 *            comparison — the same ticks under both bases — which no protocol duplication could
 *            give more cheaply or more fairly (a duplicated protocol would compare two different
 *            symbol/timeframe populations).
 * INSTEAD OF: A second protocol copy with different thresholds. Thresholds are engine constants,
 *            not per-protocol config, so a copy duplicates the protocol and compares different
 *            populations — a worse comparison for more work.
 * REVERSE BY: Set `THRESHOLD_BASIS = 'earnable'` and rebuild. One line; no maths is edited, and the
 *            bars it switches to are named constants below.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 88
 * GUARD:     nest/src/modules/scoring/signal-threshold-basis.spec.ts
 */

export type ThresholdBasis = 'configured' | 'earnable';

/**
 * The basis the classifier actually uses.
 *
 * 'configured' = the incumbent (6/13 of configured capacity). 'earnable' = the calibrated bar on
 * earn-able capacity. Per the DECISION above this stays 'configured' until the persisted comparison
 * has been read — flipping it is a maths change, not a bug fix.
 */
export const THRESHOLD_BASIS: ThresholdBasis = 'configured';

/**
 * The re-baselined bars, as a percentage of EARN-ABLE capacity.
 *
 * ⚠️ Measured, not chosen: swept over every recorded tick to reproduce the incumbent's label
 * frequency (see `logs/measure-neutral-outcomes.cjs` section 4). Do NOT hand-tune these; re-run the
 * sweep and say what population it was measured on.
 */
export const EARN_ABLE_BAR = { entry: 7.5, strong: 20 } as const;

export interface BasisInputs {
  /** `configuredSignalMax` — the divisor the persisted percentage uses. */
  configured: number;
  /** `earnableSignalMax` — configured minus capacity that cannot be earned. */
  earnable: number;
  /** Incumbent entry threshold, as a percentage of configured capacity (the live constant). */
  entry: number;
  /** Incumbent strong threshold, as a percentage of configured capacity (the live constant). */
  strong: number;
}

/**
 * Convert a bar expressed in EARN-ABLE terms onto the configured scale.
 *
 * Returns the INCUMBENT values unchanged when the conversion is unknowable (no configured capacity,
 * no earn-able capacity, or earnable > configured). Returning 0 instead — the obvious "no bar" —
 * would label every tick STRONG, which is the "an assertion over nothing" failure this repo keeps
 * paying for.
 */
export function convertThresholds(input: BasisInputs, bar = EARN_ABLE_BAR): {
  entry: number;
  strong: number;
  converted: boolean;
} {
  const { configured, earnable, entry, strong } = input;
  if (!(configured > 0) || !(earnable > 0) || earnable > configured) {
    return { entry, strong, converted: false };
  }
  const share = earnable / configured;
  return { entry: bar.entry * share, strong: bar.strong * share, converted: true };
}

/** The thresholds to classify with, given the active basis. */
export function thresholdsForBasis(basis: ThresholdBasis, input: BasisInputs): {
  entry: number;
  strong: number;
  converted: boolean;
} {
  if (basis === 'configured') return { entry: input.entry, strong: input.strong, converted: false };
  return convertThresholds(input);
}

/**
 * Both labels for one reading, so a caller persists the incumbent and the counterfactual together.
 *
 * IMPORTANT: `direction === 'none'` short-circuits to HOLD on BOTH sides. With no own-side reading
 * there is no bar to clear, and "no reading" must never be rendered as "no bar cleared" — they look
 * identical on a card but mean different things.
 */
export function classifyBothBases(
  raw: number,
  direction: 'bullish' | 'bearish' | 'none',
  input: BasisInputs,
): {
  pctConfigured: number;
  pctEarnable: number;
  configured: { entry: number; strong: number; label: string };
  earnable: { entry: number; strong: number; label: string };
} {
  const pctConfigured = input.configured > 0 ? (raw / input.configured) * 100 : 0;
  const pctEarnable = input.earnable > 0 ? (raw / input.earnable) * 100 : 0;
  const conv = convertThresholds(input);

  const label = (pct: number, entry: number, strong: number): string => {
    if (direction === 'none') return 'HOLD';
    if (pct >= strong) return direction === 'bullish' ? 'STRONG_BUY' : 'STRONG_SELL';
    if (pct >= entry) return direction === 'bullish' ? 'BUY' : 'SELL';
    return 'HOLD';
  };

  return {
    pctConfigured,
    pctEarnable,
    configured: {
      entry: input.entry,
      strong: input.strong,
      label: label(pctConfigured, input.entry, input.strong),
    },
    earnable: {
      entry: conv.entry,
      strong: conv.strong,
      label: label(pctConfigured, conv.entry, conv.strong),
    },
  };
}
