# Handoff — #461 Accounts Dashboard: Stale Accounts, Live/Practice Sections, Terminology

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#461](https://github.com/FifeCIC/Trading-Command-Suite/issues/461)

## What Changed

### "Demo" → "Practice" Rename
Consistent terminology throughout the page:
- Collapsible "Demo Accounts" section → "Practice Accounts"
- Card type badge: "Demo" → "Practice"
- Account name prefix: "Demo {login}" → "Practice {login}"
- Net Totals: "All Accounts (incl. demo)" → "All Accounts (incl. practice)"
- State variable: `showDemo` → `showPractice`
- Empty state: "No demo accounts found" → "No practice accounts found"

### ISA Panel Renamed
- "Stocks ISA" → "Trading212 Stocks ISA" (both in the Live grid card and the standalone detail panel)
- Card footer badge changed from "ISA (GBP)" → "Live" (consistent with other live cards)

### What Was NOT Changed (deferred)
- **MT5 stale account detection**: The current approach filters live MT5 accounts by hardcoded login numbers (`7240659`, `8026714`) or `type === 'live'`. A proper solution requires the Python bridge to expose account type from MT5 directly. This is a backend task.
- **ISA live/practice detection**: ISA defaults to Live. A proper check would need `TRADING212_ISA_API_KEY` classification, which is environment-level config.

### Files Changed
- `src/pages/AccountsDashboardPage.jsx` — renamed showDemo→showPractice, all Demo→Practice labels, Stocks ISA→Trading212 Stocks ISA, ISA card badge ISA→Live

### Build Verification
- Vite: `vite build` — 2908 modules, no errors
