---
date: 2026-08-17
area: scoring
type: feature
---

## What Changed

Enforced the LONG/SHORT direction contract so a protocol cannot contain a directive whose `directionBias` conflicts with its `directionMode` — caught at composition time instead of silently filtered at scoring time. Added a build-time seed validator and a runtime rejection on protocol upsert, and removed 28 pre-existing dead directive references (e.g. `rsi-overbought` (bearish) in 26 LONG_ONLY protocols) that were already being silently excluded.

## Files Changed

- nest/scripts/validate-protocol-directions.cjs — new: scans directive classes for `directionBias`, parses `protocols-seed-data.ts`, flags any protocol whose directives conflict with its `directionMode`. Wired into `prebuild`.
- nest/scripts/fix-seed-directions.cjs — new: one-off that removed the 28 conflicting references and regenerated the seed file.
- nest/src/modules/scoring/protocols.controller.ts — `upsertProtocol` now rejects composition with a direction-bias conflict (uses `classifyDirectiveInclusion`, the single source of truth).
- nest/src/modules/scoring/protocols-seed-data.ts — 28 dead directive references removed (rsi-overbought from 26 LONG_ONLY protocols, overhead-supply-pressure from mt5-technical-core-v1, earnings-momentum from mt5-technical-short).
- nest/package.json — `prebuild` now runs the validator (build fails on conflict).

## Capability Map Entry

- **name:** LONG/SHORT direction-contract enforcement
- **persistence:** none
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Direction-contract conflict is rejected
- **procedure:** POST /api/scoring/protocols with directionMode=LONG_ONLY and a `bearish` directive (e.g. rsi-overbought)
- **expected:** Response `{ success: false, error: "Direction-contract conflict: rsi-overbought (bearish) cannot be in a LONG_ONLY protocol" }`; a bullish/neutral composition succeeds.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Direction contract is now enforced at two points — a build-time seed validator (`scripts/validate-protocol-directions.cjs`, wired into nest prebuild) and a runtime rejection in `upsertProtocol` (`classifyDirectiveInclusion`). Removed 28 dead bearish/bullish directive references that scoring already excluded. Runtime `directionBias` filtering remains as a defensive fallback only.
