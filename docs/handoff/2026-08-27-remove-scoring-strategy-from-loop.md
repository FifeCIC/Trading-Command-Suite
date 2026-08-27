---
date: 2026-08-27
area: trading
type: refactor
---

## What Changed

Scoring Strategy removal from the trading pipeline (user decision 2026-08-27): the automation loop no longer reads the `scoring_strategy` table at all. The pipeline is now **Protocol → Trading Strategy → Execution**. The `scoring_strategy` table remains in the DB for MetaStack versioning/performance systems (#295) and the CRUD endpoints, but it is no longer part of trading decisions.

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — removed the per-tick scoringStrategy lookup and "Phase D.2 enforced" skip; execution params (protocolId, shortProtocolId, baseSize, slPct, tpPct) now resolve from the trading strategy row; data-readiness check uses `strat.protocolId` directly; pyramid config reads `strategy.maxPyramidTiers`; stale Phase D.2 comments updated. `saveScoringStrategy`/`deleteScoringStrategy` retained for CRUD/versioning.
- `nest/prisma/schema.prisma` — TradingStrategy fields un-deprecated (protocolId, shortProtocolId, slPct, tpPct, baseSize are now canonical loop sources); `maxPyramidTiers` added; `scoringStrategyId` re-described as a soft link for versioning/performance only.

## Capability Map Entry

- **name:** Single-strategy pipeline (scoring strategy layer retired from the loop)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading / Automation
- **name:** Loop trades and evaluates without scoring_strategy rows
- **procedure:** Confirm all active trading strategies evaluate each tick (dataStatus=ready, lastEvaluatedAt updating) with the scoring_strategy table untouched
- **expected:** Six FX strategies still evaluate with protocol-scoped signals; no scoringStrategy queries in the tick path

## Architecture Framework Entry

- **section:** routes
- **summary:** The canonical pipeline is Protocol → Trading Strategy → Execution (2026-08-27). scoring_strategy is retained as a versioning/performance registry only (#295). See #674 for the long-term redefinition discussion.

## Follow-up UI Cleanup (same date, commit 1c05872)

Frontend surfaces that still described the scoring-strategy layer were updated to match the new pipeline:

- `src/pages/AutomationOverviewPage.jsx` — chains now `{ trading, protocol, loopState }`; Scoring Strategy level removed from the stack visual; meta copy shows Trading Strategy thresholds/sizing (Protocol → Trading Strategy).
- `src/pages/SymbolFocusPage.jsx` — removed the Scoring Strategies section; focus now shows Protocols → Trading Strategies → Live Activity → Trade Outcomes.
- `src/pages/SettingsDatabasePage.jsx` — table purposes updated: trading_strategy is the canonical loop source, scoring_strategy marked retired from the loop (kept for #295).
- `src/pages/DiagramsPage.jsx` — M.E.T.A. diagram now shows Watchlist → ProtocolPair → Trading Strategy (Thresholds + Sizing + SL/TP) → Performance Rating.
- `src/pages/ProtocolsPage.jsx` — connection tooltip now says "No trading strategies linked".
- `src/pages/GlobalAllocatorPage.jsx` still reads scoring-strategy rows — accepted as a Lab prototype (no action).
