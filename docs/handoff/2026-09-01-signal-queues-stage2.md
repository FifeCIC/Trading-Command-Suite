---
date: 2026-09-01
area: signals
type: feature
---

## What Changed

#714 Stage 2 — Signal Queues view on Strategy Monitor. Bots are now visible as queues of signals with full SEES dual-score context and per-signal actions.

- **`GET /api/trading/strategies/queues`** — aggregate endpoint: all pending queue entries joined with strategy name/symbol/mode/active.
- **StrategyMonitorPage**:
  - New "Signal Queues" section: accordion rows per bot (name, mode, queue depth badge), expandable to the signal list.
  - Each signal row: symbol (links to symbols ladder), BUY/SELL direction chip, protocol (links to registry), SEES dual score at signal time (Composite · Signal · Opportunity) plus combined strength, time-ago display, Execute + Dismiss buttons.
  - Search filter (symbol/protocol/bot name) + sort control (queue depth or strength).
  - Queue-depth chip ("⏳ N queued") on each strategy card.
- **Actions**:
  - Execute → `POST /api/trading/strategies/:id/execute` (existing guarded path — respects mode/cooldown/position limits; result shown inline).
  - Dismiss → `POST /api/signals/dismiss` with strength snapshot — propagates queue → Signals (#714 + #684).

## Verification

- Live: 3 bots (Zurich USDCHF, Tokyo USDJPY, Sydney AUDUSD) with pending entries + dual scores.
- Execute guard: inactive strategy → `{"executed":false,"reason":"Strategy is not active"}` (no trade attempted).
- Dismiss propagation: synthetic pending row removed on dismiss (1 → 0).
- Filter: "usdjpy" → only Tokyo bot shown.

## Files Changed

- `nest/src/modules/trading/trading-strategy.service.ts` — `getAllQueues()`
- `nest/src/modules/trading/trading-strategy.controller.ts` — `GET queues` (declared before `:id`)
- `src/pages/StrategyMonitorPage.jsx` — queue section + card chips
- `src/pages/strategy-monitor.css` — queue view styles

## Capability Map Entry

- **name:** Strategy Monitor signal queues view
- **persistence:** stored
- **uiSurfaces:** 1 (Strategy Monitor)
- **pipeline:** signals
- **completion:** partial (#714 Stage 3 pending — loop consumes queue heads)

## QA Test Entry

- **area:** Signals / Trading
- **name:** Signal Queues view on Strategy Monitor
- **procedure:** With a live signal, open /trading/strategy-monitor → Signal Queues section shows bots with depth badges. Expand a bot → signal rows show symbol, direction, protocol, C/S/O scores, time-ago. Filter and sort work. Execute on an inactive bot refuses; dismiss removes the entry and the Signals card.
- **expected:** Queues mirror live signalling; actions guarded and non-fatal.

## Architecture Framework Entry

- **section:** routes
- **summary:** New route `GET /api/trading/strategies/queues` aggregates pending queue entries across bots. Strategy Monitor displays queues with dual-score continuity (#714 Stage 2).
