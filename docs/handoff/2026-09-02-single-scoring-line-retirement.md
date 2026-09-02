---
date: 2026-09-02
area: signals
type: refactor
---

## What Changed

#714 — the strategy-side scoring path is RETIRED. The loop now has exactly one scoring line and one trading path. No parallels.

- **One scoring line per tick**: `SignalEnvelopeService.buildBestLadder()` (called by the loop) scores every readiness-gated protocol × symbol, persists the signal score records, and syncs the trading-bot queues (routing + void rule). It also returns per-protocol scoring status, which the loop persists to `protocol_score_status` — the old step-3b scoring loop is gone.
- **One trading path**: `processSignalQueues` (queue heads → gates → `dispatchTrade`). `evaluateStrategy`, `resolveBestSignal`, and `compareProtocolPair` are deleted — the loop never re-scores a strategy.
- **Readiness gate preserved**: the loop passes the assessed-ready protocol set into `buildBestLadder`, so beta/non-ready directives never produce signals (#627).
- **Monitor continuity**: `TradingStrategyService.recordEvaluation()` writes queue-driven rows to `strategy_evaluation` (no re-scoring) so Strategy Monitor Last Score / Last Signal now reflect the queue snapshot — paper captures and executions both record.
- **A/B tests unchanged** (own scoring path, independent).

## Verification (live, demo account)

- Tick: "One scoring line: N actionable signals, queues synced" — no Gated/evaluateStrategy decisions anywhere.
- Void rule live: stale FX queue entries removed when their signals went HOLD; XAUUSD not queued (no subscribing bot).
- End-to-end with a real signal: activated Gold Day-Trade M15 + xau-speed-v1 subscription → XAUUSD STRONG_BUY routed to its queue → QueueBot paper-captured it (trading OFF) → `strategy_evaluation` gained "XAUUSD BUY 186" rows → entries stayed pending. Test setup reverted (bot deactivated, subscription and rows removed).

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — tick rewrite; ~600 lines of strategy scoring deleted
- `nest/src/modules/automation/automation.module.ts` — imports SignalsModule
- `nest/src/modules/signals/signal-envelope.service.ts` — `buildBestLadder({ allowedProtocols })` + `protocolStatus` return
- `nest/src/modules/trading/trading-strategy.service.ts` — `recordEvaluation()`

## Capability Map Entry

- **name:** Single scoring line — loop consumes queues, no strategy-side scoring
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** signals
- **completion:** complete (#714 core)

## QA Test Entry

- **area:** Signals / Trading
- **name:** No second scoring in the loop
- **procedure:** Run a tick. Verify only SCORED (protocol) + QueueBot decisions exist; no "Gated:" reasons anywhere. Verify protocol_score_status still updates and strategy_evaluation rows appear when a bot has a queue head.
- **expected:** One scoring run, one trade path; queues mirror the ladder.

## Architecture Framework Entry

- **section:** pipeline
- **summary:** Tick lifecycle is now: timeline → positions/strategies → buildBestLadder (score, persist records, sync queues) → processSignalQueues (gates, dispatch). evaluateStrategy/compareProtocolPair retired (#714). Manual `POST /api/trading/strategies/:id/evaluate` remains a user-triggered UI affordance only — the loop never calls it.
