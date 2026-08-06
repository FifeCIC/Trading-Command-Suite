# Handoff: Phase 2 — Expose hidden DB columns in UI forms (#590)

**Date:** 2026-08-06  
**Agent:** Copilot (TCS-Dev)  
**Issue:** [#590](https://github.com/FifeCIC/Trading-Command-Suite/issues/590) — Phase 2 Expose Hidden DB Columns

## What changed

### `src/pages/StrategyCreatePage.jsx` (new unified create page)

**Added 12 new form fields** organized into collapsible sections:

- **Description:** textarea added after Timeframe
- **Advanced Settings** (collapsible `▸`/`▾` toggle):
  - **Signal Filters:** `minRarityBand` (select: standard/strong/exceptional/cyclical/black-swan), `requireDirection` (select: long/short)
  - **Position & Risk Management:** `maxPositions`, `maxSize`, `maxDailyLoss`, `cooldownMinutes` — all in a 4-column grid
  - `useRaritySizing` checkbox
  - **Hot Stock Picks (#339):** `hotStockEnabled` checkbox → conditional fields: `hotStockAllocation`, `hotStockDetectionMode` (top-scoring/volume-spike/all), `hotStockMaxHoldHours`
- All fields wired into `createMutation.mutate()` payload with proper type coercion

### `src/pages/CreateStrategyPage.jsx` (old create page)

**Added 7 new form fields** in the Risk Parameters fieldset:

- `maxSize`, `maxDailyLoss`, `cooldownMinutes` — in `ff-row-3` grid
- `minRarityBand`, `requireDirection` — selects in `ff-row-3` grid
- `useRaritySizing` — checkbox
- `description` — textarea
- All wired into submit body

### `src/pages/strategy-create.css`

Added styles:
- `.sc-section-toggle` — collapsible section toggle button
- `.sc-advanced-grid` — advanced settings container with border
- `.sc-textarea` — textarea styling
- `.sc-checkbox-field`, `.sc-checkbox-label` — checkbox styling
- `.sc-field-row-3` — 3-column grid

### `src/core/forms.css`

Added `.ff-checkbox-label` style for old page checkbox.

## What was NOT changed

- `shortProtocolId` — deprecated per schema comments, not exposed
- `scoringStrategyId` — auto-set by backend seed, not a user-facing field
- `active` — toggled separately via the toggle endpoint
- `id`, `version`, `createdAt`, `updatedAt` — auto-generated

## DB columns now exposed

All 25 TradingStrategy columns are now reachable from UI forms. Only auto-generated/auto-set fields remain hidden.

## Unrelated issues identified

- Old `CreateStrategyPage.jsx` sends `maxPyramidTiers` and `slTpInheritance` to TradingStrategy endpoint — these are ScoringStrategy columns and get silently dropped. Should be moved to a ScoringStrategy creation flow.
- Old page sends `watchlistId` — not a TradingStrategy column. Silently dropped.
- `PROTOCOL_BROKER_MAP` is duplicated in both create pages. Should be extracted to a shared module.

## Verification

- ✅ Frontend build: `vite build` — clean
- ✅ Backend build: no changes needed
