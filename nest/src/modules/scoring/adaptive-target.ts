/**
 * Adaptive Target — the "realistic ceiling" for a protocol (2026-09-10)
 * ======================================================================
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A protocol's percentage is `raw / configuredSignalMax`. `configuredSignalMax` is the
 * sum of every direction-eligible directive's `maxScore` — the score IF everything fired
 * at full. That never happens, and not because the market is quiet: directives are
 * MUTUALLY EXCLUSIVE by design. `rsi-oversold` and `rsi-overbought` cannot both peak;
 * `session-open-effect` is zero outside its 30-minute window; a squeeze and a breakout
 * exclude each other.
 *
 * The result is that a protocol with 910 points of capacity where only ~200 can plausibly
 * fire on one bar scores ~20% on its best day. Measured across the live registry the
 * maximum ever recorded was 32% (#761). So `raw / configured` answers "versus a total
 * this protocol can never reach", which is not the question a trader is asking.
 *
 * THE MECHANISM
 * -------------
 * Record the protocol's own OBSERVED PEAK raw composite, and — when the operator opts in
 * per protocol — divide by that instead. The number then reads "how good is this FOR THIS
 * PROTOCOL", which is what the model actually wanted.
 *
 * ⚠️ MONOTONIC — THE PEAK ONLY EVER GOES UP
 * ----------------------------------------
 * This is the single most important property of this file, so it is stated first.
 *
 * Tempting alternatives that are WRONG:
 *   - a rolling N-day window that can fall;
 *   - a "recent typical high" (percentile) that re-bases monthly;
 *   - decaying the peak toward recent observations.
 *
 * Every one of those lets a QUIET SPELL silently lower what counts as good. If
 * `stochastic` quietly stops working, a falling target lowers the bar to match and the
 * card still reads healthy — the failure appears nowhere. This repo has hit that exact
 * class of bug repeatedly (see `.github/instructions/meta-stack-contracts.instructions.md`:
 * "plausible numbers with no error"), which is why the peak is monotonic here.
 *
 * A high-water mark is the only form of self-calibration that cannot hide decay.
 *
 * OFF BY DEFAULT. Enabling it raises every percentage for that protocol, which can
 * promote labels across the 40/80 thresholds. That is intended, but it is a deliberate
 * operator decision, not something that happens to you. It is also why the Ladder shows
 * a badge when the target is applied — a reader must be able to tell the two scales apart.
 */

/** Minimum observations before the target is trusted. Below this the configured capacity is used. */
export const ADAPTIVE_TARGET_MIN_SAMPLES = 20;

/**
 * The target may never fall below this fraction of the protocol's configured capacity.
 * A protocol that has only ever produced a near-zero peak (a genuinely broken or
 * mis-fitted protocol — `spy-speed-v1` scored max 21% originally) must not be "normalised"
 * into looking healthy. 25% keeps a dead protocol visibly dead.
 */
export const ADAPTIVE_TARGET_FLOOR_RATIO = 0.25;

/** Cap: the target can never exceed the configured capacity — that would be a denominator bug. */
export const ADAPTIVE_TARGET_CEILING_RATIO = 1.0;

export interface AdaptiveTargetState {
  enabled: boolean;
  /** The stored peak raw composite, or null when never observed. */
  peak: number | null;
  samples: number;
  since: Date | null;
}

export interface AdaptiveTargetResolution {
  /** The denominator a percentage should divide by. */
  denominator: number;
  /** True when `denominator` came from the adaptive peak rather than configured capacity. */
  applied: boolean;
  /** Why it was not applied — for the UI/API to explain itself rather than silently differ. */
  reason:
    | 'not-enabled'
    | 'insufficient-samples'
    | 'no-peak'
    | 'applied';
  /** Both numbers, always, so a caller never has to guess which scale it is on. */
  configuredMax: number;
  adaptiveMax: number | null;
}

/**
 * Resolve the denominator for a protocol.
 *
 * Returns BOTH numbers plus an explicit `reason`, so no caller can silently end up on an
 * unexpected scale. A caller that only wants the percentage takes `denominator`; a caller
 * that wants to show its working takes all of it.
 */
export function resolveAdaptiveTarget(
  state: AdaptiveTargetState,
  configuredMax: number,
): AdaptiveTargetResolution {
  const base: AdaptiveTargetResolution = {
    denominator: configuredMax,
    applied: false,
    reason: 'not-enabled',
    configuredMax,
    adaptiveMax: state.peak,
  };

  if (!state.enabled) return base;

  // The peak is only meaningful as a denominator once it rests on enough observations.
  // Before that, a single lucky tick would define the protocol's whole scale.
  if (state.samples < ADAPTIVE_TARGET_MIN_SAMPLES) {
    return { ...base, reason: 'insufficient-samples' };
  }
  if (state.peak == null || state.peak <= 0) {
    return { ...base, reason: 'no-peak' };
  }
  if (!Number.isFinite(configuredMax) || configuredMax <= 0) {
    return { ...base, reason: 'no-peak' };
  }

  const floor = configuredMax * ADAPTIVE_TARGET_FLOOR_RATIO;
  const ceiling = configuredMax * ADAPTIVE_TARGET_CEILING_RATIO;
  const bounded = Math.min(Math.max(state.peak, floor), ceiling);

  return {
    denominator: bounded,
    // `applied` means "the number actually differs from configured capacity". When the
    // peak has reached configured capacity the two coincide and there is nothing to badge.
    applied: bounded < configuredMax,
    reason: 'applied',
    configuredMax,
    adaptiveMax: state.peak,
  };
}

/**
 * Fold a new observation into the stored peak.
 *
 * Returns the value to PERSIST — or null when nothing changed, so callers can skip a
 * needless write. Monotonic: a lower reading never reduces the peak.
 *
 * `raw` must be the PRE-GATE raw composite. Using the gated composite would let a closed
 * market (which hard-gates the composite to 0) contribute a 0 and, worse, would make the
 * peak depend on whether the market happened to be open — reintroducing exactly the
 * tick-varying denominator #758 removed.
 */
export function observeAdaptiveTarget(
  state: AdaptiveTargetState,
  raw: number,
): { peak: number; samples: number; since: Date } | null {
  if (!Number.isFinite(raw) || raw <= 0) {
    // A zero/absent reading is not evidence about the ceiling. It still counts as an
    // observation for the sample floor, but it must not move the peak.
    return null;
  }
  const current = state.peak ?? 0;
  if (raw <= current && state.samples > 0) return null;
  return {
    peak: Math.max(raw, current),
    samples: state.samples + 1,
    since: state.since ?? new Date(),
  };
}

/**
 * A short human label for the reason the target is or isn't in force.
 * Kept here so the API, the tooltip and the docs cannot drift apart.
 */
export function adaptiveTargetReasonText(r: AdaptiveTargetResolution): string {
  switch (r.reason) {
    case 'not-enabled':
      return 'Adaptive Target is off — measured against configured capacity.';
    case 'insufficient-samples':
      return `Adaptive Target is on but has too few readings yet — measured against configured capacity.`;
    case 'no-peak':
      return 'Adaptive Target is on but no peak has been observed — measured against configured capacity.';
    case 'applied':
      return `Measured against this protocol's observed peak (${Math.round(r.adaptiveMax ?? 0)}), not its configured capacity (${Math.round(r.configuredMax)}).`;
  }
}
