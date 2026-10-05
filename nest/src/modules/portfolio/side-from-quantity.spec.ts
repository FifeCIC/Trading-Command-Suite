/**
 * sideFromQuantity — the rule that gives a Trading 212 holding a direction (#1069).
 *
 * ⚠️ WHAT THIS GUARDS, AND WHY IT IS NOT CEREMONY.
 *
 * The T212 import created `position` rows with `side = NULL`, and the signed profit percentage is
 * written **four times** with divergent edges: `profitPctFor()` treats an unrecognised side as LONG,
 * while `exit-consensus.service.ts:373` and both `stop-guardian.service.ts` sites treat it as SHORT.
 * For those rows the displayed direction was a **default, not a fact**.
 *
 * The fix was to establish the side where the row is created. This spec holds the rule that does it.
 *
 * ⚠️ THE CANARY IS THE `null` CASES. A "simplification" of the form
 * `return Number(quantity) < 0 ? 'sell' : 'buy'` passes every positive and negative case here and
 * fails the zero and non-numeric ones — which is exactly the regression that would put a guess back
 * into a money-adjacent column. Register row 60 is the same rule: *"NULL ≠ 0 — 'no peak observed'
 * and 'the peak was break-even' are different facts."*
 */
import { sideFromQuantity } from './trading212-import.service';

describe('sideFromQuantity — the direction a holding carries', () => {
  it('reads a positive quantity as a long position', () => {
    expect(sideFromQuantity(66.04871553)).toBe('buy');
    expect(sideFromQuantity(0.60561083)).toBe('buy');
    expect(sideFromQuantity(1)).toBe('buy');
  });

  it('reads a negative quantity as a short position', () => {
    expect(sideFromQuantity(-1)).toBe('sell');
    expect(sideFromQuantity(-0.5)).toBe('sell');
  });

  // ── CANARY: the cases that distinguish "established" from "defaulted" ──────────────────────
  it('refuses to invent a direction for a holding with no size', () => {
    expect(sideFromQuantity(0)).toBeNull();
    expect(sideFromQuantity(-0)).toBeNull();
  });

  it('refuses to invent a direction for a value that is not a number', () => {
    expect(sideFromQuantity(undefined)).toBeNull();
    expect(sideFromQuantity(null)).toBeNull();
    expect(sideFromQuantity('')).toBeNull();
    expect(sideFromQuantity('abc')).toBeNull();
    expect(sideFromQuantity(NaN)).toBeNull();
    expect(sideFromQuantity(Infinity)).toBeNull();
    expect(sideFromQuantity(-Infinity)).toBeNull();
  });

  it('accepts a numeric string, because the API contract is the caller\'s and the coercion is deliberate', () => {
    expect(sideFromQuantity('5')).toBe('buy');
    expect(sideFromQuantity('-5')).toBe('sell');
  });

  // The measured shape of the live rows, so the fixture stays honest if someone rewrites it.
  it('matches every quantity the live Trading 212 rows actually held on 2026-10-05', () => {
    const measured = [8.14035087, 66.04871553, 0.60561083, 7.13232514, 5, 6.39622641, 20,
      23, 1.3, 1, 5.2, 14.17301717, 2, 8.17064553, 36.19923472, 14, 20, 8];
    expect(measured).toHaveLength(18);
    expect(measured.every((q) => sideFromQuantity(q) === 'buy')).toBe(true);
    expect(measured.some((q) => q < 0)).toBe(false);
  });
});
