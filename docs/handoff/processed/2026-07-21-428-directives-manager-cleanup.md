# Handoff — #428 Directives Manager UI Cleanup

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#428](https://github.com/FifeCIC/Trading-Command-Suite/issues/428)

## What Changed

### a) Accordion Removed
- Removed expandable accordion sub-rows entirely
- Row click now simply selects the directive (single click)
- Chevron icons (▸/▾) removed from directive name column
- `expandedRows` state and `toggleRow` function removed

### b) TESTS Column Removed
- Table header "Tests" removed
- `testCoverage%` data cell removed from each row
- "Tests" sub-section removed from expanded area (was already gone with accordion)

### c) AVG SCORE Column Removed
- Table header "AVG Score" removed
- Average score data cell removed from each row

### d) Formula Moved to Sidebar
- "Test Results" section in sidebar replaced with "Formula" section
- Shows `selected.description || selected.formula` with `white-space: pre-wrap` for multi-line formulas
- Fallback text: "No formula description available."

### Files Changed
- `src/pages/DirectivesManagerPage.jsx` — removed accordion, expandedRows, TESTS/AVG columns, testCoverage cell; added Formula section to sidebar; simplified row click

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
