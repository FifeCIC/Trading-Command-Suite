---
date: 2026-08-13
area: scoring
type: refactor
---

## What Changed

Extracted directive inclusion (directionBias + readiness) into a single shared utility `nest/src/modules/directives/directive-inclusion.ts`, and made both the scoring engine and the protocol registry use it. Removes the duplicated inline filter logic that caused the registry/scoring maxScore drift.

## Files Changed

- nest/src/modules/directives/directive-inclusion.ts — new: `classifyDirectiveInclusion()` + `isDirectiveIncluded()` (single source of truth for directionBias/readiness inclusion).
- nest/src/modules/scoring/protocol-gating.service.ts — uses `classifyDirectiveInclusion()` in the scoring loop (keeps alpha exclusion reporting).
- nest/src/modules/scoring/protocol-gating.controller.ts — `listProtocols()` uses `isDirectiveIncluded()` for maxScore/directiveCount/directives.

## Result

One inclusion rule for the whole app. xau-speed-v1 registry maxScore = breakdown maxScore = 1460 (verified after restart).

## Capability Map Entry

- **name:** Shared directive inclusion utility
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Registry and scoring share one inclusion rule
- **procedure:** Compare /api/scoring/gated/protocols maxScore for a LONG_ONLY protocol against the breakdown subMaxTotals sum.
- **expected:** Identical. No per-endpoint directionBias/readiness logic drift.

## Architecture Framework Entry

- **section:** scoring
- **summary:** New `directive-inclusion.ts` is the single source of truth for whether a directive participates in scoring (directionBias vs directionMode + readiness alpha gate). Both ProtocolGatingService and the protocol registry import it. Files: directive-inclusion.ts, protocol-gating.service.ts, protocol-gating.controller.ts.
