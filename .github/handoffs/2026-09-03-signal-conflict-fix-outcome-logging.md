---
date: 2026-09-03
issues: [716, 717]
area: signals
type: bugfix + feature
---

## What Changed

**#716 — fake "High-severity directive conflict" removed.**
Gate groups (`isRiskGate`) are a multiplier path in protocol-gating; their subScore is structurally 0 and never contributes directional conviction. Conflict detection was including them, so every well-scoring signal produced a fake high-severity divergence (e.g. sentiment 77 vs risk 0 = 77pt spread) and got blocked. `detectConflicts` now excludes gate groups from both the bull/bear breakout counts and the divergence spread.

**#717 — structured signal-outcome logging.**
- New tables: `signal_outcome_log` (one row per persisted signal: preTradeReady + counts, keyed to the Score id) and `signal_outcome_meta` (typed entries: blocker | conflict | warning, with STABLE entryKeys like `conflict-high`, `below-gate`, `conflict-bull_bear`, plus severity, message, directiveIds).
- `SignalOutcomeService.recordOutcome()` called from `persistScores` — write-on-change dedupe so the log only grows on state changes.
- `GET /api/signals/outcomes/count?symbol=&protocolId=&entryKey=&days=7` — counts scenarios over time ("why is XAUUSD always blocked?").
- Signals cards now render conflict detail: severity glyph, description, and directive names.

## Configuration safety (user requirement)

No configuration was touched. Protocol / directive / decision config lives in seed data (`protocols-seed-data.ts`, idempotent `seedProtocolsToDatabase`) and in regular-backup DB tables (`protocol`, `protocol_directive_group`, `protocol_directive_entry`, `global_setting`, `trading_strategy`, `strategy_protocol`). The new outcome tables are LOG data (analysis), not configuration — losing them loses history only.

## Verification (live)

- Before: 4 signals, all blocked. After: XAUUSD ready=True (Buy enabled), USDJPY ready=True (new signal), AUDUSD blocked only by the genuine 1-point gate miss (64 vs 65) with its conflict demoted to low.
- `signal_outcome_log` + `signal_outcome_meta` populated per run; count endpoint returns typed aggregates.

## Files Changed

- `nest/src/modules/signals/signal-outcome.service.ts` (new)
- `nest/src/modules/signals/signal-envelope.service.ts`
- `nest/src/modules/signals/signals.controller.ts`
- `nest/src/modules/signals/signals.module.ts`
- `src/pages/SignalsOverviewPage.jsx`, `src/pages/signals-overview.css`

## Capability Map Entry

- **name:** Signal outcome logging + conflict detail on cards
- **persistence:** stored (log tables)
- **uiSurfaces:** 1 (Signals overview conflict section)
- **pipeline:** signals
- **completion:** complete (#716 closed, #717 core shipped)

## QA Test Entry

- **area:** Signals
- **name:** Conflicts reflect real disagreement; outcomes logged
- **procedure:** Run a tick; check signals cards show conflict detail with directive names; XAUUSD/other strong signals are no longer blocked by fake risk-0 divergences. Query `/api/signals/outcomes/count` for typed counts.
- **expected:** Only genuine blockers block; log rows keyed to Score ids.
