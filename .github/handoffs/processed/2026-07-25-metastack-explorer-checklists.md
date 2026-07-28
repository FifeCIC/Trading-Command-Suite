---
date: 2026-07-25
area: ui
type: feature
---

## What Changed

### Step 4: Renamed "SEES / Automation Active" → "Automation Loop"

Clarified that the Automation Loop is the scheduler (ticks every 2 minutes), while SEES is the scoring engine that runs *inside* it. Removed the "Scoring strategies configured" check from step 4 — it belongs in step 12.

### SEES Pipeline section markers

Added two section banners between stages:
- **SEES Pipeline** marker between steps 4 (Automation Loop) and 5 (Market Data)
- **SEES End** marker between steps 11 (Composite Score) and 12 (Scoring Strategy)

These visually separate the scoring engine (steps 5-11) from prerequisites (1-4) and post-scoring strategy layers (12-14).

### Step 12: Added "Strategies configured" check

Moved from step 4 to step 12 where it logically belongs. Step 12 now has 5 checks: found, configured count, enabled, threshold, watchlist linked.

### Stage action links — click to navigate to relevant pages

Added `linkTo` + `linkLabel` fields to 11 of 14 stages. Each link appears as a small bordered button in the stage header row, e.g. "Automation Dashboard →". Clicking navigates to the page where that step's configuration happens:

| Stage | Link |
|-------|------|
| Symbol Registration | /watchlists/add-symbol |
| Watchlist Setup | /watchlists/user-watchlists |
| Protocol Pairing | /scoring/configure-directives |
| Automation Loop | /automation/automation-dashboard |
| Market Data Ingestion | /watchlists/active-symbols |
| Protocol Resolution | /scoring/protocols |
| Directive Execution | /scoring/directives-manager |
| Composite Score & Signal | /scoring/live-ordering-stack |
| Scoring Strategy Rules | /trading/create-strategy |
| Trading Strategy Evaluation | /trading/trading-strategies |
| Trade Execution & Outcome | /trading/positions-monitor |

Three pure-computation stages (Condition Detection, Group Score Aggregation, Risk Gating) have no dedicated pages — no links generated.

### META.Stack Explorer — Full check-list format for all 14 stages

Converted all 14 pipeline stages to check-list format with database-backed verification. Each stage now shows individual pass/fail items instead of a single string.

### Stage 3 (Protocol Pairing) — Real data integrity checks

Replaced the broken "built-in vs user-created" timestamp heuristic (every protocol had unique millisecond timestamps, making the check meaningless) with live cross-reference checks:

- **Any protocol registered**: Count from non-gated `/api/scoring/protocols`
- **Protocols linked to scoring strategies**: Cross-references protocol IDs against scoring strategies
- **Linked watchlist exists**: Checks both `watchlistId` (FK) and `watchlistName` (label) against actual watchlists. Surfaces name-based vs ID-based links and unlinked strategies.
- **Examples**: Randomly picks linked protocols

**Key finding**: 5 of 7 scoring strategies reference watchlist name "default" which doesn't exist as a watchlist label. All 7 strategies use name-based linking (no `watchlistId` FK set). This is the gap the user asked about — the `active` field on protocols does NOT guarantee watchlist pairing or existence.

### Steps 5-11 (Core Scoring) — Scoring-aware check-lists

Each scoring stage now returns check-list arrays when a Trading Strategy is selected and scoring data is available. When no strategy is selected, shows "Awaiting strategy selection" placeholders.

Checks use actual scoring response fields:
- Market Data: bars fetched, symbol match, protocol routed
- Protocol: resolution, weight strategy, recommended timeframe
- Conditions: gating active, gated count, weight strategy
- Directives: total executed, passed gates, group coverage
- Groups: technical/sentiment/risk sub-scores
- Risk Gate: hard gate triggered, multiplier, chain length
- Composite: final score, signal, threshold check vs strategy

### Steps 12-14 (Strategy & Outcome) — DB-linked checks

- Scoring Strategy: found, enabled, trade threshold, watchlist linked
- Trading Strategy: selected, active, symbol, protocol, mode
- Outcome: open positions, total P&L, decisions logged

### Pass/fail logic fix

Fixed "Strategy enabled ✓" and "Strategy active ✓" showing as passing when no strategy was selected (undefined !== false === true). Now uses `=== true` for proper tri-state handling.

## Files Changed

- `src/pages/MetaStackExplorerPage.jsx` — Full `liveValues` useMemo restructure; all 14 stages now use check-list arrays; protocol pairing cross-reference logic; fixed dependency arrays

## Notes for Librarian

- The protocol-watchlist gap (5 unlinked strategies, all name-based) is a real data integrity finding. Not a bug in the explorer — it's surfacing existing data issues.
- The `active` field on protocols is hardcoded to `true` in `protocols.controller.ts` (line 117). Protocol model has no `active` column.
- Gated endpoint (`/api/scoring/gated/protocols`) returns different shape than non-gated — has `recommendedTimeframe`, `linkedWatchlists`, `linkedStrategies`, but no `directionMode`.
- Scoring response has no `conditions` or `protocolId` at top level — these are in `meta` or passed separately.
