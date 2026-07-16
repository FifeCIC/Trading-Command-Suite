---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Added Screen Options disc to Calculators page (#376) — floating gear button with show/hide toggles for individual calculators. History, note field, and save buttons were already implemented.

## Files Changed

- `src/pages/CalculatorsPage.jsx` — added visibility state (localStorage-backed), CALCULATOR_IDS registry, conditional rendering per calculator, Screen Options disc with dropdown checkboxes
- `src/pages/calculators.css` — added ~70 lines of Screen Options styles (floating disc, dropdown, checkboxes, count badge)

## Capability Map Entry

- **name:** Calculator Screen Options
- **persistence:** config
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Trading Tools
- **name:** Calculator Screen Options show/hide toggles
- **procedure:** Go to /trading/calculators. Click ⚙ gear in bottom-right. Uncheck a calculator. Verify it disappears and count updates. Reload page — verify preference persists.
- **expected:** Unchecked calculators hidden. Count shows "3 of 4 visible" etc. localStorage key `tcs:calc-visibility` stores state. Page reload preserves settings.

## Architecture Framework Entry

- **section:** ui
- **summary:** Calculator Screen Options — floating gear button (bottom-right, fixed) opens dropdown with checkboxes for Averaging Down, Position Size, Profit/Loss, Risk/Reward. Visibility persisted to `tcs:calc-visibility` localStorage. Components conditionally rendered. Also: calculation history (max 50, with notes) stored in `tcs:calc-history`. File: `src/pages/CalculatorsPage.jsx`. CSS: `calculators.css`.
