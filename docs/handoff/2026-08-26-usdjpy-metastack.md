---
date: 2026-08-26
area: trading
type: feature
---

## What Changed

#531 — USDJPY META.Stack end-to-end: re-activated the `Tokyo USDJPY Session` strategy (forex-session-v1, auto mode) after confirming the data path is healthy (7k+ 5m bars, fresh through today; the original pending_bars blocker is resolved). Also fixed a real scoring bug found on the way: strategy evaluation was scoring with the legacy kitchen-sink `DIRECTIVE_GROUPS` (banned default scoring) and mislabelling composites (SELL at composite 6); it is now protocol-scoped via `ProtocolGatingService` and stores the pre-gate `compositePct` so the Strategy Monitor and the automation loop speak the same 0-100 scale.

## Files Changed

- `nest/src/modules/trading/trading-strategy.service.ts` — evaluate() now protocol-scoped (scoreWithGating with strategy.protocolId), stores compositePct; removed legacy `gateScore()` + `DIRECTIVE_GROUPS` + unused `DirectivesService` injection
- `nest/src/modules/trading/trading.module.ts` — imports ScoringModule (ProtocolGatingService; no cycle — Portfolio edges are forwardRef'd)

## Capability Map Entry

- **name:** USDJPY META.Stack auto trading (protocol-scoped strategy evaluation)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading / Automation
- **name:** Strategy evaluation reflects protocol scores, not kitchen-sink scores
- **procedure:** With Tokyo USDJPY Session active, watch /api/automation/status and strategy_evaluation rows
- **expected:** dataStatus=ready; new evaluations carry compositePct-scale composite and protocol-gated signal (BUY/HOLD/SELL); no more SELL labels on composites far below threshold

## Architecture Framework Entry

- **section:** routes
- **summary:** Strategy evaluation is protocol-scoped (no unscoped default scoring anywhere in the trading path). Loop execution already used threshold-gated compareProtocolPair; the persisted evaluation now matches that scale.
