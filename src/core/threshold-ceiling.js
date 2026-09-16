/**
 * threshold-ceiling.js — does a typed bot bar exceed what its protocol can actually reach?
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE EXPRESSION (#840)
 * -------------------------------------------------------
 * The rule has three parts and one of them was already got wrong once while written inline in JSX:
 * the ceiling field was read as `ceilingPct` in one place and `ceiling` in another, so the form
 * rendered "highest recorded result is %" with NO number. It looked plausible in a screenshot and
 * only a browser check caught it, because JSX has no test harness here.
 *
 * Pure logic does not need a DOM. This file is covered by `node --test` (see the sibling
 * `.test.js`), which is the same arrangement the notices and roadmap modules use.
 *
 * ⚠️ THE SAMPLES FLOOR IS NOT DECORATION. A ceiling computed from three readings is not evidence —
 * it is three readings. Without the floor, a brand-new protocol would show a warning on its first
 * day, for a bar that is probably fine, and the warning would be wrong often enough to be ignored.
 * 10 matches the floor `ProtocolHealthService` uses before it will claim a ceiling at all.
 */

/** The backend's minimum before it will assert a protocol's ceiling. Mirrors ProtocolHealthService. */
export const MIN_CEILING_SAMPLES = 10;

/**
 * Compare a typed bar against a protocol's measured ceiling.
 *
 * @param {object|null|undefined} ceiling  `{ ceilingPct, samples }` from
 *                                         `GET /api/scoring/gated/thresholds` → `protocolCeilings`.
 * @param {number|string|null|undefined} bar  The `minComposite` the user has entered.
 * @returns {null | { bar: number, ceiling: number, samples: number }}
 *          `null` when there is nothing to warn about — which covers BOTH "the bar is fine" and
 *          "we cannot judge". The caller must not treat those as the same thing for display
 *          purposes, so it also exposes `ceilingKnown()` below.
 */
export function barAboveCeiling(ceiling, bar) {
  if (!ceiling) return null;
  const samples = Number(ceiling.samples ?? 0);
  if (!Number.isFinite(samples) || samples < MIN_CEILING_SAMPLES) return null;

  // ⚠️ THE null/'' CHECK IS LOAD-BEARING, AND ITS ABSENCE WAS A REAL BUG.
  // `Number(null)` is 0 and `Number('')` is 0 — both FINITE — so a missing `ceilingPct` silently
  // became "this protocol's ceiling is 0%", and every bar above zero (i.e. every bar) warned.
  // A protocol with no measurement would have accused the user's perfectly reasonable bar.
  // Caught by `threshold-ceiling.test.js`, not by reading the code.
  if (ceiling.ceilingPct == null || ceiling.ceilingPct === '') return null;
  const ceilingPct = Number(ceiling.ceilingPct);
  if (!Number.isFinite(ceilingPct)) return null;

  const value = Number(bar);
  // An empty field is not a zero bar — `Number('')` is 0, which would silently read as "below the
  // ceiling" and is the kind of coercion that makes a form lie about its own state.
  if (bar === '' || bar == null || !Number.isFinite(value)) return null;
  if (value <= ceilingPct) return null;

  return { bar: value, ceiling: ceilingPct, samples };
}

/**
 * Can this protocol's ceiling be stated at all? Separate from `barAboveCeiling` because "we have a
 * measured ceiling and your bar is fine" must render differently from "we have no idea" — showing
 * the same thing for both is how an unmeasured protocol looks like a healthy one.
 */
export function ceilingKnown(ceiling) {
  if (!ceiling) return false;
  const samples = Number(ceiling.samples ?? 0);
  // Same null guard as `barAboveCeiling` — see the note there. `Number(null) === 0` would report a
  // 0% ceiling as a MEASURED one, which is worse than reporting nothing.
  if (ceiling.ceilingPct == null || ceiling.ceilingPct === '') return false;
  return Number.isFinite(samples) && samples >= MIN_CEILING_SAMPLES && Number.isFinite(Number(ceiling.ceilingPct));
}
