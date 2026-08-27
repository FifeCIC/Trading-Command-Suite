---
date: 2026-08-27
area: ui
type: refactor
---

## What Changed

Strategy view cleanup (user-directed, 2026-08-27): deleted the retired scoring-strategy-era pages — StrategyBuilderPage (`/scoring/strategy-builder`), StrategyDashboardPage (`/trading/strategy-dashboard`), CreateStrategyPage (`/trading/create-strategy` + CSS). All 25 trading-strategy fields were already reachable via the canonical StrategyCreatePage, so nothing was ported. Strategy Comparison promoted from Legacy to the main Trading list and relabelled "Trading Strategy Comparison". Strategy Allocator moved from Planner to Lab → Prototypes (`/lab/allocator`, redirect kept from `/planner/allocator`) with "Scoring Strats" renamed "Scoring Protocols". MetaStack Explorer stage + SetupBanner relabelled to trading-strategy language with fixed links.

## Files Changed

- `src/core/nav-tree.js` — scoring/trading/planner/lab nav changes
- `src/core/view-routes.jsx` — imports + map entries removed; duplicates fixed
- `src/core/view-meta.js` — deleted entries, relabel, allocator route moved
- `src/App.jsx` — deleted page imports removed; `/planner/allocator` → `/lab/allocator` redirect
- `src/pages/GlobalAllocatorPage.jsx` — "Scoring Strats" → "Scoring Protocols"
- `src/pages/MetaStackPipelinePage.jsx` — lane "Scoring Strategies" → "Strategy Binding"; ss-create node now binds trading strategy (files/endpoints/tables updated)
- `src/pages/MetaStackExplorerPage.jsx` — stage retitled, link fixed to `/trading/strategy-create`
- `src/components/SetupBanner.jsx` — "Create Scoring Strategy" → "Create Trading Strategy", link fixed
- `src/pages/{StrategyCreatePage,StrategyMonitorPage,StrategiesPage}.jsx` — copy updates
- `src/core/{page-data-status,experience-levels,view-explanations,asset-types,broker-utils}.js` — registry/comment updates
- `src/data/qa-checklist.js` — consolidation entries updated for the new reality
- deleted: `StrategyBuilderPage.jsx`, `StrategyDashboardPage.jsx`, `CreateStrategyPage.jsx`, `create-strategy.css`, `strategy-dashboard.css`

## Capability Map Entry

- **name:** Strategy view consolidation (single-strategy pipeline UI)
- **persistence:** none
- **uiSurfaces:** -3
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading / UI
- **name:** Retired pages gone, canonical pages intact
- **procedure:** Navigate /scoring/strategy-builder, /trading/strategy-dashboard, /trading/create-strategy (expect 404/no route); then /trading/strategy-monitor, /trading/strategy-create, /trading/strategy-comparison, /lab/allocator (expect render)
- **expected:** Removed routes dead; Strategy Comparison shows "Trading Strategy Comparison"; allocator under Lab/Prototypes shows "Scoring Protocols"

## Architecture Framework Entry

- **section:** routes
- **summary:** Three retired strategy views deleted (Strategy Builder, Strategy Dashboard, old Create Strategy); Strategy Comparison promoted; Strategy Allocator moved to Lab Prototypes. UI now speaks the canonical Protocol → Trading Strategy → Execution pipeline.
