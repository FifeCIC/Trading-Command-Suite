---
date: 2026-09-09
area: scoring
type: bugfix
---

## What Changed

`gold-round-numbers` v1.3.0 → v1.4.0 (first fix of the issue #731 directive-guard sweep).

- Scores are now **magnitude-only** (25/15/8 for major/minor/micro proximity). The
  2026-08-16 Phase B "signed 0-centered" rebase emitted negative scores (−25/−15/−8),
  which the engine boundary (`DirectivesService.sanitizeDirectiveResult`) clamps to
  `[0, maxScore]` — so every bearish signal was zeroed before aggregation and the log
  spammed 4× "clamped at boundary" warnings per tick.
- Direction now travels in `signalClass` (bullish above the level, bearish below),
  matching MST-002 and the `bullishRaw`/`bearishRaw` accumulation in
  `protocol-gating.service.ts`.
- Two mirror tests added to `indicator-symmetry.spec.ts`: just-above vs just-below
  $2600 produce bullish/bearish with equal magnitude; non-gold symbols stay neutral.
- Guard Run #1 baseline recorded: 0 errors, 199 warnings; full triage in
  `docs/directive-restructure-reconciliation.md` §5 and on issue #731.

## Files Changed

- nest/src/modules/directives/implementations/gold-round-numbers.directive.ts — magnitude-only scores, positive clamp, header doc corrected; v1.4.0
- nest/src/modules/directives/implementations/indicator-symmetry.spec.ts — 2 mirror tests
- docs/directive-restructure-reconciliation.md — §5 guard triage + fix table

## Why (theory)

The engine's scoring contract is: `score` = evidence **magnitude** in `[0, maxScore]`,
`signalClass` = direction. Direction must never be encoded inside the score magnitude,
because the sanitize boundary and the bull/bear accumulation both assume magnitude-only
scores. The signed-scale idea predated that contract and silently lost all bearish
evidence at the boundary — a runtime defect invisible except for the warning spam.

## Next in the #731 queue

1. `earnings-proximity` / `cad-usd-oil-correlation` — guard mode-4 producer-trace
   (`input.earningsDate` / `input.wtiValue` have no producers).
2. Constant-output review: `budget-gate`, `rollover-risk`, `pattern-density-sr`,
   `position-size-kelly`.
3. Guard mode 7 — point the readiness-evidence check at the real signal store.

## Capability Map Entry

- **name:** Gold round-number proximity signals (magnitude-only scoring)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** Gold-round-numbers mirror tests
- **procedure:** `npm --prefix nest test -- --testPathPatterns=indicator-symmetry`
- **expected:** 9 tests pass — mirrored price series → mirrored signalClass with equal magnitude; no negative scores

## Architecture Framework Entry

- **section:** directives
- **summary:** gold-round-numbers emits magnitude-only scores (25/15/8) with direction in signalClass; previously signed scores were clamped to zero at the engine boundary, destroying bearish evidence. Covered by mirror tests. Files: gold-round-numbers.directive.ts, indicator-symmetry.spec.ts.
