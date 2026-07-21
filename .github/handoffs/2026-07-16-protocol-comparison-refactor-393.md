---
date: 2026-07-16
area: automation
type: refactor
---

## What Changed

Extracted triplicated dual-protocol LONG vs SHORT comparison logic into a single `compareProtocolPair()` shared function in `automation-loop.service.ts`. Replaced 3 identical code blocks (step 3b watchlist loop, evaluateStrategy scoreMap path, evaluateStrategy no-scoreMap path) with calls to the shared function.

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — Added `compareProtocolPair(longGated, shortGated, threshold)` function + `ProtocolComparison` interface; replaced 3 triplicated comparison blocks (~35 lines each) with single function calls (~4 lines each)

## Capability Map Entry

- **name:** Dual-Protocol Comparison Refactor — shared compareProtocolPair()
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Automation
- **name:** Verify dual-protocol LONG/SHORT comparison is consistent
- **procedure:** Start automation loop with a dual-protocol strategy (e.g., built-in-default vs built-in-short). Observe tick decisions — BUY/SELL/HOLD should behave identically to before the refactor.
- **expected:** All 3 call sites produce identical results. No change in trading behavior. Decision log shows same composite/signal values.

## Architecture Framework Entry

- **section:** automation
- **summary:** Dual-protocol LONG vs SHORT comparison logic extracted into single `compareProtocolPair()` function. 3 call sites (step 3b watchlist, evaluateStrategy with/without scoreMap) now share the same implementation. Any future changes to the comparison algorithm only need one edit.
