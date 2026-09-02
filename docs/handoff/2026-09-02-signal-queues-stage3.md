---
date: 2026-09-02
area: signals
type: feature
---

## What Changed

#714 Stage 3 — Expert Trading Bot: the loop processes signal queues. The legacy strategy-evaluation path is LEFT INTACT and keeps running; the queue processor is additive and shares the same safety chain.

- **`processSignalQueues()`** in the automation loop, called after legacy strategy evaluation each tick:
  - Reads each active auto-mode bot's strongest pending entry (`strategy_signal_queue`) — NO re-scoring, uses the queue's SEES snapshot.
  - Gate order: botQueueEnabled → mode=auto → data readiness → `minComposite` vs `compositePct` (same scale the legacy path used) → strategy cooldown → **bot pacing** (inter-trade delay, default 10m) → trading layer/broker OFF ⇒ paper capture (#695) → `dispatchTrade` shared chain (layer, 60s symbol + 3s global cooldown, duplicate guard, diversification).
  - Consumed ONLY on EXECUTED/QUEUED (`status='executing'`). BLOCKED/FAILED stays pending for the next tick.
- **No double-trading**: legacy runs first; shared `lastSymbolTrade`/`lastAnyTradeAt` maps mean one trade per symbol per minute across both paths.
- **New settings** (persisted in `global_setting`, restored on boot): `automation.botQueueEnabled` (default ON), `automation.botInterTradeDelayMinutes` (default 10).
- **Endpoints**: `GET/POST /api/automation/bot-queue`.
- **UI**: META.Stack Pipeline layer strip gains an "Expert Bot (queues)" pill — pause/resume + delay input.
- **Bug fix**: `recordPaperTrade` dedupe signature now set only AFTER a successful insert (failed inserts no longer poison the map).
- **DB**: recreated `paper_trade` table (was missing — earlier paper captures silently failed).

## Verification (live, trading layer OFF)

- Tick with queues: USDCHF (132 ≥ 55) → paper capture; AUDUSD (63 ≥ 55) → paper capture; USDJPY (26 < 60) → stays queued. Entries remain pending after paper (dry-run does not consume).
- Bot-queue kill switch: 0 QueueBot decisions while disabled.
- Config persistence: delay 7 → GET confirms; restored to 10m.
- Consume SQL verified with a synthetic row (pending → executing).

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts`
- `nest/src/modules/automation/automation.controller.ts`
- `src/pages/MetaStackPipelinePage.jsx`, `src/pages/meta-stack-pipeline.css`

## Capability Map Entry

- **name:** Expert Trading Bot — loop processes signal queues
- **persistence:** stored
- **uiSurfaces:** 1 (META.Stack Pipeline layer strip)
- **pipeline:** trading
- **completion:** partial (#714 — legacy path retirement pending proof)

## QA Test Entry

- **area:** Trading
- **name:** QueueBot processes queues without re-scoring
- **procedure:** With trading OFF and queued signals above minComposite, run a tick → paper rows appear, queue stays pending. With trading ON (user opt-in), auto bots dispatch the strongest entry and the entry moves to 'executing'. Pacing respects the delay setting.
- **expected:** One trade per symbol per minute max across both paths; no duplicate dispatch.

## Architecture Framework Entry

- **section:** pipeline
- **summary:** Loop step 4 gains a queue-processing tail: `processSignalQueues` dispatches bot queue heads through the shared `dispatchTrade` chain. Legacy `evaluateStrategy` remains as the comparison path until the queue path is proven, after which its scoring section retires (#714).
