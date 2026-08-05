# Handoff — #460 View Info Popovers

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#460](https://github.com/FifeCIC/Trading-Command-Suite/issues/460)

## What Changed

### View Explanation Registry
New file `src/core/view-explanations.js` — maps view IDs to explanation text. The info icon (ℹ️) automatically appears in the sticky button group for any view that has an entry in this registry.

### ScreenOptions Info Button
- Added ℹ️ button to the `so-sticky-btns` disc group (between bookmark ☆ and calculator C)
- Only renders when `VIEW_EXPLANATIONS[activeView]` exists
- Click toggles a styled popover showing the explanation text
- Popover uses `app-notice--info` color scheme (accent blue) matching the existing Notice component
- Close button (×) in top-right corner

### Speed Scanner
- Removed the inline `<Notice level="info">` block from `SpeedScannerPage.jsx`
- Removed unused `Notice` import
- Explanation text moved to `VIEW_EXPLANATIONS['speed-scanner']` in the registry

### Registered Views (initial set)
| View ID | Explanation |
|---------|-------------|
| `speed-scanner` | Real-time directive scoring, composite %, trend clarity, recommendations |
| `sees-arena` | Protocol comparison grid, agreement/disagreement between protocols |
| `live-ordering-stack` | Ladder ranking, scoring signals, filters, drill-down |
| `metastack-display` | META.Stack protocol system, directive groups, version history |
| `directives-manager` | Directive registry catalog, scoring rules, enable/disable |
| `strategy-comparison` | Side-by-side strategy performance, win rate, P&L, drawdown |
| `active-symbols` | Active symbol browser, filters, research page links |

### Files Changed
- `src/core/view-explanations.js` — new file, explanation registry
- `src/components/ScreenOptions.jsx` — import registry, info state, info button + popover markup
- `src/components/screen-options.css` — `.so-info-wrap`, `.so-info-popover`, `.so-info-pop-title`, `.so-info-pop-text`, `.so-info-pop-close`
- `src/pages/SpeedScannerPage.jsx` — removed inline Notice + import

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
- No backend changes needed

### Extending
To add an explanation for another view, add an entry to `src/core/view-explanations.js`:
```js
'view-id': 'Concise explanation text.',
```
The ℹ️ icon will automatically appear for that view. No component changes needed.
