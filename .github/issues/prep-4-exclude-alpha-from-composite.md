## Problem

ALPHA directives (mock-neutral, stubs, placeholders) currently contribute their neutral-50 score to the protocol composite. This drags the composite toward the middle and masks what the READY directives are actually saying. A protocol with 3 READY directives and 7 ALPHA directives produces a composite that is ~30% noise.

## Task

In the scoring pipeline, when aggregating directive scores into the protocol composite, exclude any directive where `readiness === 'alpha'`. The directive still appears in the breakdown output with a `"mock — excluded from composite"` flag, but its score is not included in the aggregation.

## Steps

- [ ] Identify the aggregation point in the scoring pipeline (likely `protocol-gating.service.ts` or `scoring.service.ts`)
- [ ] Add filter: skip directives where `readiness === 'alpha'` (or where readiness field is missing — treat as alpha)
- [ ] Add `excluded: true, exclusionReason: 'mock — not ready'` flag to excluded directives in the breakdown
- [ ] Adjust composite normalization: only divide by the maxScores of INCLUDED directives
- [ ] Add a summary field: `readinessBreakdown: { ready: 3, bravo: 4, alpha: 7, alphaExcluded: 7 }`
- [ ] Verify: protocol with 3 READY + 7 ALPHA → composite reflects only the 3 READY directives
- [ ] Verify: protocol with all ALPHA directives → composite = 0 with "all directives excluded" warning
- [ ] Verify: protocol with all READY directives → composite unchanged (no regression)

## Acceptance

- [ ] ALPHA directives excluded from composite calculation
- [ ] Exclusion visible in breakdown (flag + reason)
- [ ] READY-only protocols produce identical scores to before (no regression)
- [ ] All-ALPHA protocols produce composite=0 with clear warning
- [ ] Mixed protocols show honest composite from only real directives
- [ ] Build passes

## Related

- #516 (Layer A: Readiness Tiers)
- Prep #1: Audit all 104 directives
- Prep #2: Add readiness field to IDirective
