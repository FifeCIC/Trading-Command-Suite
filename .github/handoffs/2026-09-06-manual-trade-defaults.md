---
date: 2026-09-06
area: trading
type: feature
---

## What Changed

#720 — Signals manual-trade defaults are now persisted and user-editable. `size` (lots) / `slPct` / `tpPct` moved out of inline hardcoded values into `global_setting` (seeded 0.01 / 2 / 4), read at order time by `placeManualTrade`. A single `TradingSettingsPage` is reachable from two entry points (Settings → Trading and Trading → Settings), and the Signals card confirm state shows the resolved size/SL/TP before the order.

## Files Changed

- nest/src/modules/signals/manual-trade-defaults.service.ts — NEW: get/set defaults in global_setting (keys `signals.manualTrade.{size,slPct,tpPct}`), validation + seeded fallback
- nest/src/modules/signals/signals.controller.ts — GET/PUT /api/signals/trade-defaults
- nest/src/modules/signals/signal-actions.service.ts — placeManualTrade reads defaults when body omits size/slPct/tpPct
- nest/src/modules/signals/signals.module.ts — register/export ManualTradeDefaultsService
- src/pages/TradingSettingsPage.jsx + trading-settings.css — NEW settings form
- src/core/view-routes.jsx, view-meta.js, nav-tree.js — register `trading-settings` (two nav entries, one component)
- src/core/api/signals.js — fetchTradeDefaults()
- src/pages/SignalsOverviewPage.jsx — confirm state shows resolved size/SL/TP

## Capability Map Entry

- **name:** Manual-Trade Defaults (size/SL/TP)
- **persistence:** stored
- **uiSurfaces:** 2
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading
- **name:** Manual-trade defaults persist and flow into orders
- **procedure:** Settings → Trading (or Trading → Settings) → edit size/SL/TP → Save; then GET /api/signals/trade-defaults
- **expected:** PUT persists; GET returns the edited values; the Signals card confirm state shows them; placeManualTrade uses them when the body omits size/slPct/tpPct

## Architecture Framework Entry

- **section:** trading
- **summary:** Manual-Trade Defaults — persisted in global_setting (keys signals.manualTrade.size/slPct/tpPct, seed 0.01/2/4), read at order time by placeManualTrade. Endpoints: GET/PUT /api/signals/trade-defaults. UI: TradingSettingsPage (view id `trading-settings`) mounted under both Settings → Trading and Trading → Settings.
