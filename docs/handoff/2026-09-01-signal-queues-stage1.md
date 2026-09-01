---
date: 2026-09-01
area: signals
type: feature
---

## What Changed

Signal queues for trading bots (#714 Stage 1 — additive). The ONE scoring line now routes its per-protocol signal records into per-bot queues; the Signals ladder itself is untouched.

- **`strategy_signal_queue` table** (raw SQL, utf8mb4_0900_ai_ci to match trading_strategy): one pending entry per (strategyId, protocolId, symbol) with a full SEES snapshot (compositePct, signalPct, opportunityPct, combinedStrength, scoreId).
- **`SignalQueueService.syncQueues()`** called from `buildBestLadder` after the ladder is built:
  - Routes every actionable per-protocol record (collected BEFORE the best-of display merge) into bots whose subscriptions match the protocol and whose symbol scope matches.
  - Same protocol+symbol re-signal REPLACES the old entry (unique key upsert).
  - Void rule: protocols scored this run drop pending entries for symbols that no longer signal.
  - Honours dismissals (dismissed signals don't route).
- **Dismissal propagation**: `dismissSignal` now also removes pending queue entries (symbol+protocol, or symbol-wide for 'any').
- **Endpoint**: `GET /api/trading/strategies/:id/queue` — pending queue for a bot, strongest first.

## Verification

- Live: USDJPY→Tokyo bot, AUDUSD→Sydney bot, USDCHF→Zurich bot queued after a best-ladder run; XAUUSD (xau-speed-v1) correctly not queued (no active bot subscribes).
- Queue endpoint returns the dual-score snapshot (BigInt-safe Number mapping).

## Files Changed

- `nest/src/modules/signals/signal-queue.service.ts` (new)
- `nest/src/modules/signals/signals.module.ts`
- `nest/src/modules/signals/signal-envelope.service.ts` — routing collection + sync call + dismissal propagation
- `nest/src/modules/trading/trading-strategy.service.ts`, `trading-strategy.controller.ts` — queue endpoint

## Capability Map Entry

- **name:** Trading-bot signal queues (routing from the one scoring line)
- **persistence:** stored
- **uiSurfaces:** 0 (endpoint only — Stage 2 adds the monitor UI)
- **pipeline:** signals
- **completion:** partial (#714 Stage 2/3 pending)

## QA Test Entry

- **area:** Signals / Trading
- **name:** Signals route into bot queues with dedupe and void
- **procedure:** Trigger /api/signals/best with an actionable protocol+symbol subscribed by an active bot → queue row appears with the dual-score snapshot. Re-run with the signal gone (HOLD) → row is voided. Dismiss the signal → row removed.
- **expected:** Queue mirrors live signalling per bot; no duplicates; voided on non-signalling re-score.

## Architecture Framework Entry

- **section:** routes
- **summary:** New table `strategy_signal_queue` and route `GET /api/trading/strategies/:id/queue`. Signals route into bot queues from `buildBestLadder` (pre-merge per-protocol records). Bots still evaluate via the legacy loop path until Stage 3 (#714) retires it.
