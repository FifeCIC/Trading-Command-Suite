---
date: 2026-09-03
area: trading
type: feature
---

## What Changed

#723 — one shared execution-feasibility library (`ExecutionFeasibilityService.assess`) now runs at BOTH signal generation (annotating envelopes with `executionBlockers` + change-hints, rendered pre-click on the Signals cards with the trade button disabled) and execution (`placeManualTrade` re-runs the same assessment as the authoritative click-time check). Includes the #719 broker symbol-availability gate (cached 5-min bridge `/symbols` list). Also fixes STRONG_BUY direction mapping (long signals previously rendered a Sell button).

## Files Changed

- nest/src/modules/trading/execution-feasibility.service.ts — NEW shared assess(): symbol-unavailable → market-closed → duplicate-position (maxPyramidTiers policy) → scale-in → diversification → 60s cooldown; each blocker has stable key + message + hint
- nest/src/modules/providers/adapters/mt5.adapter.ts — getSymbols() with 5-min symbolsCache TTL (bridge GET /symbols)
- nest/src/modules/trading/trading.module.ts — registers/exports ExecutionFeasibilityService, imports DiversificationModule (was a DI resolution failure at boot)
- nest/src/modules/signals/signal-envelope.service.ts — executionBlockers on envelope + emptyEnvelope; buildBestLadder assesses each envelope reusing the per-run mt5Positions fetch
- nest/src/modules/signals/signal-outcome.service.ts — execution-blocker meta rows incl. new hint column (ALTER TABLE signal_outcome_meta ADD COLUMN hint)
- nest/src/modules/signals/signal-actions.service.ts — placeManualTrade collapses inline market/dup/div/cooldown checks into assess(); throws blockers[0].message
- src/pages/SignalsOverviewPage.jsx — ⛔ blocker section with hints, trade button disabled with tooltip; direction fix
- src/pages/signals-overview.css — .sig-opp-exec styles

## Capability Map Entry

- **name:** Execution Feasibility (shared pre-flight)
- **persistence:** cached
- **uiSurfaces:** 1
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Trading
- **name:** Signal card shows execution blockers pre-click and execution re-checks
- **procedure:** Open /signals with open MT5 positions — cards with an open position show ⛔ "Duplicate blocked…" and the Buy/Sell button is disabled with a tooltip; POST /api/signals/{id}/trade returns the same 400 message
- **expected:** XAUUSD/AUDUSD cards show duplicate-position hint; VIX cards show "Broker mt5 has no VIX instrument"; trade endpoint rejects with identical messages

## Architecture Framework Entry

- **section:** trading
- **summary:** Execution Feasibility — one assessment library, two phases. ExecutionFeasibilityService.assess() produces keyed blockers (symbol-unavailable, market-closed, duplicate-position, scale-in-locked, diversification, cooldown) each with an actionable change-hint. Generation phase: buildBestLadder annotates envelopes → card UI + outcome logging. Execution phase: placeManualTrade re-runs assess() as the authoritative check. Files: execution-feasibility.service.ts, signal-envelope.service.ts, signal-actions.service.ts.
