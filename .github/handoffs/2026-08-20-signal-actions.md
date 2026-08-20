---
date: 2026-08-20
area: signals
type: feature
---

## What Changed

Backend support for the Signals area (#662): a bot-action indicator for a signal and a manual trade-action endpoint, both built on the existing scoring + execution stack.

## Files Changed

- nest/src/modules/signals/signal-actions.service.ts — new: `getBotAction(signalId)` (correlates a Score-row signal with decision_log EXECUTED/QUEUED and trade records → none | pending | filled) and `placeManualTrade(signalId, body)` (market-status gate → duplicate guard → diversification → 60s cooldown → broker.placeOrder with SL/TP → tradeRecorder origin=manual).
- nest/src/modules/signals/dto/manual-trade.dto.ts — new: side required, symbol/protocolId/brokerId/size/slPct/tpPct optional.
- nest/src/modules/signals/signals.controller.ts — added `GET /api/signals/:id/action` and `POST /api/signals/:id/trade`.
- nest/src/modules/signals/signals.module.ts — imports TradingModule, DiversificationModule, ProvidersModule; registers SignalActionsService.
- src/core/architecture-reference.js — route contracts for both endpoints.

## Capability Map Entry

- **name:** Signal actions (bot-action state + manual trade)
- **persistence:** none new (reuses decision_log + trade)
- **uiSurfaces:** 0 (backend; Signals frontend consumes it)
- **pipeline:** signals
- **completion:** complete

## QA Test Entry

- **area:** Signals
- **name:** Signal action + manual trade safety
- **procedure:** `GET /api/signals/:scoreId/action` (real run id) → returns action. `POST /api/signals/:id/trade` with brokerId=binance → 400 (no order support); with a market-closed signal → 400 "Market closed". Unknown signal → 404.
- **expected:** verified live 2026-08-20 (XAUUSD → action none; market-closed block + 404 confirmed). Live order placement is left to the Signals UI user action — do not auto-fire.

## Architecture Framework Entry

- **section:** signals
- **summary:** Signals is the actionable layer over scoring. A signal = a Score row; bot-action state correlates via decision_log and trade.scoringStrategyId. Manual trades reuse the bot's safety chain verbatim (same duplicate guard, diversification, cooldown semantics) and are recorded origin=manual/source=signals — never bypassing risk controls.
