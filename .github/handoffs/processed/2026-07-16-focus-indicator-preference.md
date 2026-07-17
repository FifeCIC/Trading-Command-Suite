---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Added focus indicator style preference (#359) — users can choose Strong (2px solid accent, default), Subtle (1px dashed), or None for keyboard focus rings. Follows the existing pattern from `fontScale` (#357) and `highContrastText`.

## Files Changed

- `src/core/hooks/usePreferences.js` — added `focusIndicatorStyle: 'strong'` default
- `src/components/ScreenOptions.jsx` — radio preference in GLOBAL_PREFERENCES + variable extraction + useEffect sync to `<html>` attribute
- `src/App.jsx` — sets `data-focus-indicator-style` on mount + cross-tab storage listener
- `src/index.css` — 3 CSS rules: `:root[data-focus-indicator-style="strong|subtle|none"] :focus-visible`

## Capability Map Entry

- **name:** Focus Indicator Preference
- **persistence:** config
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Accessibility
- **name:** Focus indicator style preference changes keyboard focus ring
- **procedure:** Open Screen Options (⚙), find "Focus Indicator" radio. Switch between Strong/Subtle/None. Tab through page elements to verify focus ring changes.
- **expected:** Strong = 2px solid accent outline. Subtle = 1px dashed accent outline. None = no visible outline. Preference persisted across page reloads and browser tabs.

## Architecture Framework Entry

- **section:** ui
- **summary:** Focus Indicator Preference — user-selectable `:focus-visible` style via `data-focus-indicator-style` attribute on `<html>`. Stored in `tcs:preferences` localStorage (key: `focusIndicatorStyle`, default: `strong`). Applied through 3 CSS rules targeting strong (2px solid var(--accent)), subtle (1px dashed var(--accent)), none (outline: none). Pref registration: ScreenOptions.jsx GLOBAL_PREFERENCES array. Runtime sync: App.jsx mount effect + storage listener.
