---
date: 2026-08-14
area: scoring
type: bugfix
---

## What Changed

Repaired `gold-macro-correlation` — a real directive wearing an inflated denominator. Its DXY→gold base score is correct, but its yield/VIX bonus tiers (+35) could never fire because `treasury10Y` and `vixValue` are never written anywhere in the pipeline (same dead-input disease found in `vix-regime`). The directive could only ever reach 100, but the protocol counted 135.

Fix: removed the unreachable yield/VIX bonus branches, set `maxScore` 135→100, trimmed `requiredDataFeeds` to `['dxy']`, bumped version 2.0.1→2.1.0. The DXY→gold core is unchanged.

## Files Changed

- nest/src/modules/directives/implementations/gold-macro-correlation.directive.ts — removed YIELD_HIGH/YIELD_LOW/VIX_FEAR constants, yield/VIX bonus computation, and the now-dead `yield10Y`/`vixValue` input reads; maxScore 135→100; updated docstring + description + requiredDataFeeds.

## Result

`gold-macro-correlation` now reports 77/100 (was 77/135). xau-speed-v1 registry maxScore 1,270 → 1,235 (−35). XAUUSD xau-speed-v1 signal remains BUY.

Still `beta` readiness — open item for the "a protocol should not be active while it contains non-ready directives" policy discussion.

## QA Test Entry

- **area:** Scoring
- **name:** gold-macro-correlation denominator honesty
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 → sentiment group gold-macro-correlation reports score/maxScore where maxScore=100 (not 135); GET /api/scoring/gated/protocols → xau-speed-v1 maxScore=1235.
- **expected:** maxScore=100; no "135" in the gold-macro reason.
