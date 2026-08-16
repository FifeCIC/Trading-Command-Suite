---
date: 2026-08-14
area: scoring
type: bugfix
---

## What Changed

Deleted the `vix-regime` directive entirely. It was rubbish: a stub wearing a `ready` badge. `calculate()` reads `input.vixValue`, which is never written anywhere in the codebase (grep-verified: 2 reads, 0 writes), so it always returned a constant 45/100 neutral @ confidence 0.15 with reason "No VIX data provided… Connect VIX feed (Finnhub/FMP) or use SPY realized-vol proxy." It produced zero signal and diluted the composite denominator by 100 in ~40 protocols — including half of xau-speed-v1's risk group.

The VIX→gold relationship it pretended to cover is already handled by `gold-macro-correlation`.

## Files Changed

- nest/src/modules/directives/implementations/vix-regime.directive.ts — DELETED (the "ready" class)
- nest/src/modules/directives/implementations/placeholder-directives.stub.ts — deleted duplicate VixRegimeDirective stub class
- nest/src/modules/directives/directives.module.ts — removed import/provider/constructor/register
- nest/src/modules/directives/directive-groups.ts — removed from default risk group + BTC speed risk group
- nest/src/modules/directives/directive-suitability.registry.ts — removed entry
- nest/src/modules/directives/directives.controller.ts — removed from multi-source list + nature map
- nest/src/modules/scoring/protocol-db.service.ts — removed from EURUSD multi-source list
- nest/src/modules/scoring/protocols-seed-data.ts — removed from all 40 protocols (via scripts/remove-seed-directive.cjs)
- nest/src/modules/strategies/strategy-seeds.ts — removed from 4 strategy directiveIds
- nest/src/modules/strategies/strategy-prerequisites.ts — removed from 2 requiredDirectives
- nest/src/modules/strategies/data/built-in-strategies.seed.json — deleted "vix-regime" strategy entry
- src/data/strategy-library.js — removed directiveMapping entry
- src/pages/CapabilityMapPage.jsx — removed KNOWN_FEATURES entry
- nest/seed-capabilities.cjs — removed capability entry

## Result

xau-speed-v1 registry maxScore 1,370 → 1,270 (−100); directive count 13 → 12. Risk group now only `liquidity-check`. **Signal for XAUUSD xau-speed-v1 went HOLD → BUY** (composite ~43.5%). DB rows for vix-regime: 0 (1 directive row, 5 global_setting keys, 40 protocol_directive_entry rows deleted).

## QA Test Entry

- **area:** Scoring
- **name:** Deleted directive absent from scoring and registry
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 and check risk group; GET /api/directives and confirm vix-regime absent; GET /api/scoring/gated/protocols and confirm xau-speed-v1 maxScore=1270, count=12.
- **expected:** vix-regime no longer appears anywhere; xau-speed-v1 signal = BUY.
