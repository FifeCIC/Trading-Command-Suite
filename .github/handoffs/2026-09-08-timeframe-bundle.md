---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Closed MST-004 for the live scoring paths: added `ProtocolGatingService.loadHigherTfBundle(symbolId, protocolId?)`
(a shared loader that fetches `1d`/`1h`/`15m` bars sized to the protocol's `getRequiredBars()`) and passed the
bundle at 8 live `scoreWithGating` call sites that previously omitted it — so multi-timeframe directives
(`multi-timeframe-trend`, MTF confluence, etc.) now receive real higher-TF data instead of silently scoring
from base bars only.

Sites fixed: automation-loop (A/B test), protocol-gating controller (single-symbol + portfolio), trading-strategy
evaluate, protocol-consensus, sector-rotation, arena (per-strategy best-of + per-symbol comparison).

## Files Changed

- nest/src/modules/scoring/protocol-gating.service.ts — injected MarketDataService + added loadHigherTfBundle
- nest/src/modules/automation/automation-loop.service.ts — pass bundle in A/B test
- nest/src/modules/scoring/protocol-gating.controller.ts — pass bundle (single + portfolio)
- nest/src/modules/trading/trading-strategy.service.ts — pass bundle
- nest/src/modules/scoring/protocol-consensus.service.ts — pass bundle (hoisted per symbol)
- nest/src/modules/scoring/sector-rotation.service.ts — pass bundle (added ticker→UUID lookup)
- nest/src/modules/scoring/arena.controller.ts — pass bundle (both endpoints)

## Why (theory)

Multi-timeframe directives declare higher-TF bar requirements (`dayBars`/`hourBars`/`min15Bars`) in their
`minBars` contract. When a caller passes only base bars, those directives cannot produce evidence — they either
return "unavailable" or, worse, silently re-use the base series as a proxy for the micro timeframe. Supplying the
bundle is what makes the directive's declared feeds actually present at evaluation time (correctness-review
invariant #4: "declared feeds and timeframes are present or the result says unavailable").

## Capability Map Entry

- **name:** Higher-timeframe bundle at live scoring call sites
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** partial (backtest/replay/protocol-runner/snapshot-comparison remain — historical MTF)

## QA Test Entry

- **area:** Scoring
- **name:** MTF directives receive higher-TF bars on live paths
- **procedure:** `npm --prefix nest run build` (tsc + direction-contract validation pass); spot-check a multi-timeframe protocol score via GET /api/scoring/gated
- **expected:** Build clean; multi-timeframe directives show non-neutral evidence (not "unavailable")

## Architecture Framework Entry

- **section:** scoring
- **summary:** ProtocolGatingService now exposes loadHigherTfBundle (1d/1h/15m sized to getRequiredBars) and 8 live scoreWithGating call sites pass the bundle, so MTF directives receive declared higher-TF data. Remaining historical paths (backtest/replay/snapshot-comparison) and protocol-runner (no UUID) still omit it.
