---
date: 2026-08-17
area: scoring
type: feature
---

## What Changed

Added the Phase 2 suitability filter — a pure, static join of protocol/symbol metadata that answers "does this symbol structurally fit any protocol?" No directive evaluation, no market data, no bars, no scores. This is the handover gate into a watchlist: attention ≠ conviction.

## Files Changed

- nest/src/modules/suitability/suitability.service.ts — pure `evaluateOne`/`evaluateAll`, `inferProtocolSymbolTypes` (slug/tradingStyle heuristic), `deriveShortable` (forex/crypto structurally shortable; others via tags; unknown otherwise).
- nest/src/modules/suitability/suitability.controller.ts — `GET /api/suitability/:ticker` and `POST /api/suitability/evaluate`.
- nest/src/modules/suitability/dto/evaluate-suitability.dto.ts — `EvaluateSuitabilityDto` (ticker + optional type/shortable).
- nest/src/modules/suitability/suitability.module.ts — module registration.
- nest/src/modules/suitability/suitability.service.spec.ts — 12 unit tests.
- nest/src/app.module.ts — registered `SuitabilityModule`.

## Rules

1. Direction: SHORT_ONLY excludes a symbol with `shortable === false`; `undefined` (unknown) never excludes.
2. Type: enforced only when the protocol declares/infers `symbolTypes` AND the symbol type is known.
3. Timeframe: informational note only (suitability is pre-data).

## Capability Map Entry

- **name:** Suitability filter
- **persistence:** none (reads protocol + symbol tables)
- **uiSurfaces:** 0 (API only; Phase 3 screener will call it)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Suitability
- **name:** Suitability evaluates with zero market data
- **procedure:** `POST /api/suitability/evaluate` with `{ticker:"BRANDNEW"}` (no Symbol row)
- **expected:** `fits=16/16` with `type=null, shortable=null`; `NVDA` (stock) excludes `xau-speed-v1` ("symbol type stock not in [commodity]") and spy/qqq index protocols.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Suitability is a static metadata join layered *before* the scoring engine. `SuitabilityService` is pure (unit-testable, no I/O); the controller loads active protocols' static fields and resolves symbol type/tags from the Symbol table. Unknown metadata never excludes — a freshly surfaced screener hit always evaluates. SHORT_ONLY direction contract mirrors #620.
