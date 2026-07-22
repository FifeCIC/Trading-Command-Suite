# Handoff — #450 Screen Options: Practice Account Data Toggle

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#450](https://github.com/FifeCIC/Trading-Command-Suite/issues/450)

## What Changed

### Infrastructure Added
- **`hidePracticeData`** preference added to Screen Options → Global Preferences as a checkbox
  - Label: "🧪 Hide Practice Data"
  - Description: "Hide paper trading and practice account positions across all views"
  - Default: OFF (show everything)
  - Stored in `tcs:preferences` localStorage key
- Added to `usePreferences` hook default values
- Added to `globalValueMap` in ScreenOptions rendering

### How Views Can Use It
Any view can read the preference via `usePreferences()`:
```jsx
const prefs = usePreferences();
const hidePractice = prefs.hidePracticeData === true;

// Filter practice data
const filtered = hidePractice
  ? positions.filter(p => p.mode === 'live')
  : positions;
```

### Views That Should Implement (future work)
- Trading Strategies — filter POS column counts
- Positions Monitor — hide practice positions
- Portfolio Overview — filter practice holdings
- Portfolio Events — filter practice events
- Any view displaying trading/portfolio data

### Files Changed
- `src/components/ScreenOptions.jsx` — added hidePracticeData to GLOBAL_PREFERENCES, prefs read, globalValueMap
- `src/core/hooks/usePreferences.js` — added default value

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
