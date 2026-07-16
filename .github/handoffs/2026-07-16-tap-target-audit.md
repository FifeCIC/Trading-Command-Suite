---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Audited and fixed tap target sizes across the Trading Command Suite to meet WCAG 2.5.5 accessibility standards. Added global minimum sizing rules for all interactive elements and increased padding/dimensions on 15+ undersized button patterns.

## Files Changed

- `src/index.css` — Added global tap-target minimums (24px AA, 44px AAA for primary actions), checkbox sizing (24×24px), and pseudo-element hit-area extension for inline links. Fixed `.rail-collapse-toggle`, `.sa-factor-chip`, `.mt5-close-btn`, `.mt5-close-all`, `.mt5-lot-btns button`, and `.msc-mode-btn` sizing.
- `src/components/PatternDetailPanel.css` — Increased `.close-btn` padding and added 44×44px minimums
- `src/components/screen-options.css` — Expanded `.so-close-btn` from 32×32px to 44×44px
- `src/pages/Mt5DemoTradingPage.css` — Increased `.mt5-close-btn` padding and added min dimensions
- `src/pages/Mt5TradingPage.css` — Increased `.mt5u-remove-btn` padding and added 44×44px minimums
- `src/pages/positions-monitor.css` — Increased `.pm-close-btn` padding for 44px height
- `src/pages/TradeJournalPage.css` — Increased `.tj-btn-sm` padding and font-size
- `src/pages/multi-strategy-comparison.css` — Increased `.msc-mode-btn` padding and font-size
- `src/pages/pattern-scanner.css` — Increased `.ps-tf-pill` and `.ps-filter button` sizing
- `src/pages/scoring-activity-logs.css` — Increased `.sal-filters button` sizing
- `src/pages/responsive-layout-lab.css` — Fixed `.rll-col-toggle`, `.rll-col-toggle input`, and `.rll-col-reset` sizing
- `src/pages/snapshot-replay.css` — Increased `.sr-speed-btn` sizing

## Capability Map Entry

- **name:** Tap Target Accessibility (WCAG 2.5.5)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** UI / Accessibility
- **name:** Tap target minimum sizes
- **procedure:** Navigate to any page with buttons (e.g., Trading Strategies, Pattern Scanner, Positions Monitor). Open DevTools and verify interactive elements (buttons, checkboxes, close buttons) have dimensions ≥44×44px. Test on mobile/tablet viewport to verify tappability.
- **expected:** All standalone buttons have min-height ≥44px. All checkboxes are ≥24×24px. No interactive element is smaller than 24×24px. Close buttons on panels are usable on touch devices.

## Architecture Framework Entry

- **section:** ui
- **summary:** Tap Target Accessibility — WCAG 2.5.5 compliance for all interactive elements. Global CSS rules enforce 24px minimum (AA level) for all buttons/links/inputs, 44px minimum (AAA) for primary action buttons. Checkbox inputs sized at 24×24px with accent-color. Pseudo-element hit-area extension available for inline text links via `.tap-inline` class. Files: index.css (global rules), 11 page/component CSS files (specific fixes).
