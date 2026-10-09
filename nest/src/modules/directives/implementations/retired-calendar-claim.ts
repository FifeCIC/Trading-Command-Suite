import { DirectiveResult } from '../interfaces/directive.interface';

/**
 * retiredCalendarClaim() — ONE home for the "a dated bias must be MEASURED or silent" state (#879).
 *
 * Eighteen directives carried a near-identical retired block (score 0 / confidence 0 / neutral /
 * unmeasured + a reason naming the measurement state). Seventeen copies of that shape is exactly
 * the technical debt this repo warns about — both copies drift and only one gets the next fix.
 * The duplicate-block build gate (`validate-duplication.cjs`) forced the extraction, correctly:
 * this file is now where BOTH the `unmeasured` contract and any wording change happen, and a
 * future retirement is one call.
 *
 * ⚠️ The REASON stays a per-directive argument and must stay specific — each one records the
 * measurement state that retired the claim (the numbers in it are the point):
 *   - refuted on this data  → "friday-drift retired: measured 50.7% vs a 52.7% baseline …"
 *   - unmeasurable here     → "September slump retired: unmeasured — one September (n=1) …"
 * A generic reason would erase the only evidence the retirement rests on.
 */
export function retiredCalendarClaim(reason: string): DirectiveResult {
  return {
    score: 0,
    confidence: 0,
    signalClass: 'neutral',
    unmeasured: true,
    reason,
  };
}
