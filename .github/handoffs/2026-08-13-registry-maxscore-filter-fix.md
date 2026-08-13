---
date: 2026-08-13
area: scoring
type: bugfix
---

## What Changed

Fixed a protocol-total maxScore mismatch between the Symbols Ladder (registry endpoint) and Protocol Trail (scoring breakdown). The registry summed ALL directives in a protocol's groups, while the scoring engine applies directionBias + readiness filters. For LONG_ONLY protocols this inflated the denominator (xau-speed-v1 showed 1,600 vs the real 1,460 — the 140 diff was the bearish `rsi-overbought` directive, correctly excluded from scoring).

## Files Changed

- nest/src/modules/scoring/protocol-gating.controller.ts — `listProtocols()` now mirrors the scoring engine's inclusion filters (LONG_ONLY drops bearish, SHORT_ONLY drops bullish, alpha readiness excluded) when computing `groups.directives`, `maxScore`, and `directiveCount`.

## Result

xau-speed-v1: registry maxScore 1,600 → 1,460, directiveCount 15 → 14. Registry and breakdown now agree (both 1,460). Verified xau-speed-m5 (1,460), gold-macro-v1 (1,225), btc-speed-v1 (1,740).

## Capability Map Entry

- **name:** Registry maxScore matches scoring filters
- **persistence:** ephemeral
- **uiSurfaces:** 1 (Symbols Ladder)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Symbols Ladder denominator equals Protocol Trail denominator
- **procedure:** Open Symbols Ladder, note the "/1,600" style denominator for xau-speed-v1, then click into Protocol Trail and compare.
- **expected:** Both show the same denominator (1,460 for xau-speed-v1). No directive-filtered mismatch.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Protocol registry (GET /api/scoring/gated/protocols) now applies the same directionBias + readiness inclusion filters as the scoring engine when computing maxScore and directiveCount, so Symbols Ladder and Protocol Trail share one denominator. File: protocol-gating.controller.ts.
