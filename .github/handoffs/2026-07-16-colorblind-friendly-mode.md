---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Added color-blind friendly mode preference that adds shape/pattern indicators (▲/▼ arrows, +/- prefixes, stripe fills) alongside color coding. Does not remove colors — adds redundant cues per WCAG 1.4.1. Toggle in Screen Options panel under "Color-Blind Friendly" checkbox.

## Files Changed

- src/core/hooks/usePreferences.js — added `colorBlindMode: false` default
- src/App.jsx — added `data-colorblind` attribute propagation on mount and storage events
- src/components/ScreenOptions.jsx — added "🎨 Color-Blind Friendly" checkbox to GLOBAL_PREFERENCES, value tracking, and useEffect for data-colorblind attribute
- src/index.css — added `:root[data-colorblind='true']` block with CSS overrides for arrow prefixes, P&L +/- signs, badge pattern fills, border style changes, and (BUY)/(SELL) button labels
- .github/instructions/accessibility-policy.instructions.md — marked Color-blind friendly mode as implemented, updated last-reviewed date

## Capability Map Entry

- **name:** Color-Blind Friendly Mode
- **persistence:** localStorage (tcs:preferences.colorBlindMode)
- **uiSurfaces:** 1 (Screen Options panel + CSS-driven across all pages)
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** UI / Accessibility
- **name:** Color-blind friendly mode adds shape indicators alongside colors
- **procedure:** Open Screen Options (⚙), check "Color-Blind Friendly". Navigate to any page with P&L columns (Positions Monitor, Dashboard), buy/sell buttons, or status badges.
- **expected:** Green profit values show ▲ prefix, red loss values show ▼ prefix. Buy buttons show (BUY) label, sell buttons show (SELL) label. Badges with failed/sell use diagonal stripe pattern. Badges with passed/buy use horizontal line pattern. All original colors remain visible.

## Architecture Framework Entry

- **section:** status
- **summary:** Color-Blind Friendly Mode — WCAG 1.4.1 redundant cue preference. Toggles via Screen Options → `data-colorblind="true"` on :root. CSS selector-based pseudo-element indicators (▲/▼, +/-, pattern fills) on profit/loss/buy/sell classes. No backend changes. Files: usePreferences.js, App.jsx, ScreenOptions.jsx, index.css.
