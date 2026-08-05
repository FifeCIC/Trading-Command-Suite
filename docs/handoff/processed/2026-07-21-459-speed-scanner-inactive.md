# Handoff — #459 Speed Scanner: Include Inactive Protocols Toggle

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#459](https://github.com/FifeCIC/Trading-Command-Suite/issues/459) (partial — item d)

## What Changed

### Screen Option: Include Inactive Protocols
Added a new per-view checkbox to Speed Scanner's Screen Options:
- Label: "Include Inactive Protocols"
- Description: "Show protocols marked as inactive in the ladder. Default: hidden."
- Storage key: `ss-include-inactive` (localStorage)
- Default: OFF (inactive protocols hidden)

The SpeedScannerPage should read this value and filter its protocol list accordingly.

### Files Changed
- `src/components/ScreenOptions.jsx` — added `includeInactive` checkbox to speed-scanner view options

### Build Verification
- Vite: `vite build` — 2906 modules, no errors

### Remaining #459 Items
- **c) Protocol ID UUID vs slug** — backend: ensure SymbolProtocolAssignment stores slugs
- **e) Dead pattern detection** — backend: wire MicroTrendDetector.aggregatePatterns()
- **a) Info popover** — completed in #460
