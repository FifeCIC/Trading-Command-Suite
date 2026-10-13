import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convictionPercent } from './conviction';

/**
 * #915 Option C — the second reading must be a DIAGNOSTIC, and it must be distinguishable from
 * zero.
 *
 * ⚠️ WHY THE `null` CASES ARE THE IMPORTANT ONES. `normalizeScorePercent(raw, 0)` returns 0, so
 * the obvious implementation renders "no directive read directionally this tick" as "the
 * directives that spoke agreed on 0%" — an absence presented as a measurement, which is this
 * repo's most expensive failure signature. These tests pin that distinction, not the arithmetic.
 *
 * ⚠️ WHY THE PLACEMENT TEST EXISTS. `INV-STABLE-DENOMINATOR` is enforced by
 * `nest/scripts/validate-pipeline-contracts.cjs` → `scanObservedDenominator()`, scoped to
 * `src/modules/scoring`. That scan matches the exact identifier shapes
 * `signalMax | observedMaxTotal | totalMax`; this helper's parameter is named `observedMax`, so
 * MOVING THIS MODULE INTO `scoring` WOULD KEEP THE BUILD GREEN while placing a second, observed
 * denominator beside the configured one — where it would read as a sanctioned alternative and
 * weaken the guard it sits next to. Nothing else notices that, so it is asserted here.
 *
 * Canary: `git mv conviction.ts ../scoring/` fails the placement test, and nothing else in the
 * suite changes colour.
 */
describe('convictionPercent (#915 Option C)', () => {
  it('reports the share of the capacity that actually read', () => {
    expect(convictionPercent(50, 200)).toBe(25);
    expect(convictionPercent(0, 200)).toBe(0);
  });

  it('answers a DIFFERENT question from signalPct — same numerator, different denominator', () => {
    // The live `gold-macro-v1` figures verified 2026-10-13: raw 50 points against a configured
    // capacity of 795 (the Signal reading) and an observed capacity of 185 (the conviction).
    const raw = 50;
    expect(convictionPercent(raw, 795)).toBeCloseTo(6.29, 2);
    expect(convictionPercent(raw, 185)).toBeCloseTo(27.03, 2);
    expect(convictionPercent(raw, 185)).toBeGreaterThan(convictionPercent(raw, 795) as number);
  });

  it('returns null — NOT 0 — when nothing read directionally', () => {
    // The whole point: 0 would read as "those that spoke agreed on nothing".
    expect(convictionPercent(0, 0)).toBeNull();
    expect(convictionPercent(50, 0)).toBeNull();
    expect(convictionPercent(50, null)).toBeNull();
    expect(convictionPercent(50, undefined)).toBeNull();
    expect(convictionPercent(50, Number.NaN)).toBeNull();
    expect(convictionPercent(50, -1)).toBeNull();
  });

  it('refuses a numerator it could not earn, rather than reporting a number', () => {
    expect(convictionPercent(Number.NaN, 200)).toBeNull();
    expect(convictionPercent(Number.POSITIVE_INFINITY, 200)).toBeNull();
  });

  it('clamps at 100', () => {
    expect(convictionPercent(400, 200)).toBe(100);
  });

  it('lives OUTSIDE src/modules/scoring, so it cannot read as a second scoring denominator', () => {
    // The spec is co-located with its module, so `__dirname` IS the module's directory.
    const here = __dirname.replace(/\\/g, '/');
    expect(here).toContain('/modules/signals');
    expect(here).not.toContain('/modules/scoring');

    // …and the scoring module has not grown its own copy.
    const gating = readFileSync(
      join(__dirname, '..', 'scoring', 'protocol-gating.service.ts'),
      'utf8',
    );
    expect(gating).not.toContain('convictionPercent');
  });
});
