# Handoff — #431 Ladder: Rename, Weak Pairing Notice, Filter Inactive Protocols

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#431](https://github.com/FifeCIC/Trading-Command-Suite/issues/431)

## What Changed

### a) Renamed "Live Ordering Stack" → "Ladder"
| File | Change |
|------|--------|
| `LiveOrderingStackPage.jsx` | → `LadderPage.jsx` (file renamed) |
| `src/App.jsx` | Import updated |
| `src/core/view-routes.jsx` | Import + VIEW_COMPONENTS updated |
| `src/core/nav-tree.js` | Label: "Ladder" |
| `LadderPage.jsx` | JSDoc, `<h1>`, `<h2>`, section headers all "Ladder" |

Route `/scoring/live-ordering-stack` unchanged to preserve bookmarks.

### b) Weak Pairing Notice Updated
Downgraded from critical to caution:
- Before: `⚠ Weak pairing — consider a different protocol`
- After: `⚠️ Unrecognised pair — signals may be weak. Consider reviewing the protocol combination.`

### c) Filter Inactive Protocols
Deferred — protocol select filtering needs `showInactive` parameter on the shared protocol selector component. Backward-compatible default.

### Files Changed
- `LiveOrderingStackPage.jsx` → `LadderPage.jsx` (renamed + content updates)
- `src/App.jsx` — import updated
- `src/core/view-routes.jsx` — import + entry updated
- `src/core/nav-tree.js` — nav label updated

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
