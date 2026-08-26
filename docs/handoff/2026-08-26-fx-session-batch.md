---
date: 2026-08-26
area: trading
type: feature
---

## What Changed

Quick-win batch (#526–#530) — reactivated the five dormant auto strategies on forex-session-v1: Sydney AUDUSD, GBPUSD Session, Wellington NZDUSD, USDCAD Forex Session, Zurich USDCHF (joining Tokyo USDJPY from #531). All six now read dataStatus=ready, evaluate every loop tick with protocol-scoped compositePct, and show consistent HOLD signals. No code change — DB activation only; execution remains gated by brokerStates.mt5.tradingEnabled=false until the user enables demo trading.

## Files Changed

- (none — `trading_strategy.active=1` DB update for 5 rows)

## Capability Map Entry

- **name:** FX Session META.Stacks live (6 pairs scoring)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** partial (scoring live; execution awaits tradingEnabled)

## QA Test Entry

- **area:** Trading / Automation
- **name:** Six FX session strategies score each tick
- **procedure:** GET /api/automation/status
- **expected:** All six show dataStatus=ready with lastEvaluatedAt updating; signals are protocol-scoped (HOLD comp 20–35 at quiet market)

## Architecture Framework Entry

- **section:** routes
- **summary:** Automation loop working set now includes all six FX session pairs (USDJPY/USDCAD/GBPUSD/USDCHF/NZDUSD/AUDUSD) under forex-session-v1.
