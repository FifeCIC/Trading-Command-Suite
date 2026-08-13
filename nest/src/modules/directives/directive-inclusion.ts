/**
 * Directive Inclusion — SINGLE SOURCE OF TRUTH
 * ============================================
 * Every part of the app that asks "does this directive participate in
 * scoring for this protocol?" MUST go through `classifyDirectiveInclusion()`.
 * Do NOT re-implement the directionBias / readiness rules inline — that is
 * how the registry and the scoring engine drifted apart (issue: Symbols
 * Ladder maxScore 1600 vs Protocol Trail 1460).
 *
 * Rules (mirror docs/readiness-tiers.md and IDirective.directionBias):
 *  1. readiness === 'alpha' (mock/stub/placeholder) → always excluded.
 *  2. directionBias vs directionMode:
 *     - LONG_ONLY  excludes 'bearish'
 *     - SHORT_ONLY excludes 'bullish'
 *     - 'neutral'  is always included
 */

export type DirectiveInclusion = 'included' | 'direction-bias' | 'readiness-alpha';

export interface DirectiveLike {
  directionBias?: 'bullish' | 'bearish' | 'neutral';
  readiness?: 'alpha' | 'beta' | 'ready';
}

/**
 * Classify whether a directive is included in scoring for the given
 * protocol directionMode. Returns a verdict string so callers can report
 * WHY a directive was excluded (e.g. the scoring engine logs alpha
 * exclusions for transparency).
 */
export function classifyDirectiveInclusion(
  directive: DirectiveLike | null | undefined,
  directionMode: string,
): DirectiveInclusion {
  if (!directive) return 'readiness-alpha';

  if ((directive.readiness ?? 'alpha') === 'alpha') return 'readiness-alpha';

  const bias = directive.directionBias ?? 'neutral';
  if (directionMode === 'LONG_ONLY' && bias === 'bearish') return 'direction-bias';
  if (directionMode === 'SHORT_ONLY' && bias === 'bullish') return 'direction-bias';

  return 'included';
}

/** Convenience boolean wrapper — true only when fully included. */
export function isDirectiveIncluded(
  directive: DirectiveLike | null | undefined,
  directionMode: string,
): boolean {
  return classifyDirectiveInclusion(directive, directionMode) === 'included';
}
