---
date: 2026-08-16
area: scoring
type: feature
---

## What Changed

Closed the missing link between the per-protocol directive config (#609) and the scoring engine. Overrides persisted by the config UI now actually change scores: effective maxScore is resolved as **protocol override → global config → directive class** in both the scoring engine and the protocol registry, so a weight edit changes the score, the ladder denominator, and the registry display consistently.

## Files Changed

- nest/src/modules/scoring/protocol-gating.service.ts — `resolveEffectiveMaxScores()` loads global + protocol config once per score; `scoreWithGating()` uses it instead of the class maxScore
- nest/src/modules/scoring/protocol-gating.controller.ts — `listProtocols()` loads all config once and uses an `effectiveMax()` helper so registry maxScore/directives match what gets scored
- nest/src/modules/scoring/directive-config.service.ts — added `getAllProtocolOverrides()` (batch read of all `protocol:*` keys)

## Capability Map Entry

- **name:** Scoring honors per-protocol directive overrides
- **persistence:** stored (global_setting)
- **uiSurfaces:** 2 (Protocols Registry, Symbols Ladder denominators)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Override changes the score
- **procedure:** PATCH xau-speed-v1 speed-momentum maxScore to 500, then GET the score and the registry.
- **expected:** Score breakout shows speed-momentum maxScore=500 (Signal max = 25+500=525); registry total becomes 1390; DELETE restores 120.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Directive maxScore is now resolved with precedence protocol override → global config → class, in both the scoring engine (`resolveEffectiveMaxScores`) and the registry. This makes the #609 config UI and the #637 timeframe matrix runtime-effective.
