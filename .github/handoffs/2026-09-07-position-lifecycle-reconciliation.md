---
date: 2026-09-07
area: trading
type: feature
---

## What Changed

Closed the position-lifecycle gap (#616 + #470): the app now captures the 64-bit MT5 ticket as a string (`brokerTicket`), creates `Trade` rows for broker positions opened outside the app, and finalizes externally-closed positions with the real exit price plus configurable notifications. The trailing-stop guardian now auto-starts with the automation loop, applies two-layer stops (always-set relaxed broker protective floor + tighter app trailing, with broker-modification throttling), and notifies on stop adjustments. Also extracted the #721 scale-in/pyramid policy into a single shared `PyramidPolicyService` used by BOTH the bot and manual trade paths, with a `maxPyramidTiers` fallback default on the #720 manual-trade settings.

## Files Changed

- nest/prisma/schema.prisma — `Position` gains `brokerTicket`/`side`/`magic` (64-bit ticket as string)
- nest/src/modules/providers/interfaces/provider-adapter.interface.ts — `BrokerPosition` enriched; new `BrokerDeal` + `getDeals()`
- nest/src/modules/providers/adapters/mt5.adapter.ts — populates ticket/side/sl/tp/magic/comment; implements `getDeals()`
- nest/src/modules/providers/position-sync.service.ts — ticket-keyed reconcile, foreign-trade creation, close detection with deal-history exit + notifications
- nest/src/modules/trading/trade-recorder.service.ts — writes `brokerTicket`; clamps legacy Int ticket
- nest/src/modules/trading/mt5-trading.service.ts — bot order path writes `brokerTicket` + magic
- nest/src/modules/signals/signal-actions.service.ts — manual trade path writes `brokerTicket` + magic
- nest/src/modules/trading/pyramid-policy.service.ts (NEW) — shared scale-in/pyramid decision library (#721)
- nest/src/modules/trading/execution-feasibility.service.ts — delegates duplicate/scale-in block to pyramid policy
- nest/src/modules/trading/trading.module.ts — registers/exports PyramidPolicyService
- nest/src/modules/automation/automation-loop.service.ts — bot path uses pyramid policy; auto-starts/stops guardian
- nest/src/modules/automation/stop-guardian.service.ts — two-layer stops (protective floor + trailing) + broker-modification throttle + notifications
- nest/src/modules/automation/automation.module.ts — imports NotificationsModule
- nest/src/modules/notifications/notifications.service.ts — new `position-opened`/`position-closed`/`stop-adjusted` events
- nest/src/modules/signals/manual-trade-defaults.service.ts — adds `maxPyramidTiers` default (#721 fallback)
- nest/src/modules/signals/signals.controller.ts — PUT trade-defaults accepts `maxPyramidTiers`
- nest/src/modules/trading/trade-history.controller.ts — new `GET /api/trading/position-lifecycle` feed
- nest/src/modules/providers/position-sync.service.ts — tracks `lastResult` (synced/created/closed) for status dashboards
- nest/src/modules/automation/automation.controller.ts — exposes `positionSync` in `/api/automation/status`
- nest/src/modules/notifications/notifications.service.ts — persists mapped events as `Alert` rows (survive restart + Alert Center)
- src/pages/TradeJournalPage.jsx — DB-first (trade table) with brokerTicket/origin/source; + CSS
- src/pages/DailySummaryReportPage.jsx — DB-first positions + closed trades (bridge-independent)
- src/pages/PositionLifecyclePage.jsx (NEW) — Lab prototype: Position Lifecycle Monitor
- src/pages/position-lifecycle.css (NEW)
- src/core/view-routes.jsx + src/core/nav-tree.js — register `position-lifecycle` Lab view

## Capability Map Entry

- **name:** Position Lifecycle Reconciliation, Scale-in Policy & Lifecycle Monitor
- **persistence:** stored
- **uiSurfaces:** 3
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading
- **name:** External position captured, journaled, and external close notified
- **procedure:** With the MT5 bridge running, open a position in MT5 directly (not via TCS), let the automation loop tick, then close it in MT5 and let it tick again. Check Trade Journal, the Position Lifecycle Monitor (Lab), and notifications.
- **expected:** A `Trade` row appears with `brokerTicket` = the real 64-bit ticket and `origin=external` (visible in the journal + lifecycle monitor); after the close a `position-closed` notification fires and the trade is finalized with `exitPrice`/`pnl`.

## Architecture Framework Entry

- **section:** data
- **summary:** Position lifecycle reconciliation — `PositionSyncService` is the single broker↔DB bridge keyed on `brokerTicket` (64-bit MT5 ticket as string). Scale-in policy — `PyramidPolicyService` is the one shared library for one-per-symbol vs opt-in scale-in (green + SL-locked + tier limit), consumed by both the manual path (`ExecutionFeasibilityService`) and the bot path (`AutomationLoopService.dispatchTrade`). Knob = `TradingStrategy.maxPyramidTiers`, falling back to `signals.manualTrade.maxPyramidTiers`. UI: Trade Journal and Daily Summary Report are now DB-first (`/api/trading/trade-history`); new Lab prototype `Position Lifecycle Monitor` at `/lab/position-lifecycle` backed by `GET /api/trading/position-lifecycle`. Files: position-sync.service.ts, pyramid-policy.service.ts, mt5.adapter.ts, trade-recorder.service.ts, PositionLifecyclePage.jsx. Notifications: position-opened / position-closed / stop-adjusted.
