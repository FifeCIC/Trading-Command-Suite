# Handoff: SPRINT Batch 6 — Trading + Automation Fixes (#568–#572)

**Date:** 2026-08-04
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Implemented 5 changes across Trading and Automation areas.

## Changes

### #568 — Trading Plans promoted + overflow fix
- **Files:** `src/core/nav-tree.js`, `src/pages/trading-plans-page.css`
- **What:**
  - Moved `trading-plans` out of Legacy section into main Trading menu (after Trading Strategies)
  - Reduced sidebar width: 340px → 280px
  - Added `overflow: hidden` to `.trading-plans-page` container
  - Added `min-width: 0` to `.plans-detail` (flex item shrink)

### #569 — Calculators topbar button
- **Files:** `src/App.jsx`, `src/index.css`, `src/components/ScreenOptions.jsx`
- **What:**
  - Removed "C" calculator button from ScreenOptions (bottom-right buttons)
  - Added 🧮 "Calculators" button in topbar, to the left of the "Online" status button
  - Added `.topbar-calc-btn` CSS matching the status button style (44px touch target)
  - Button navigates to `/trading/calculators`

### #570 — Renamed Trading212 → Accounts
- **File:** `src/core/nav-tree.js`
- **What:** Changed area label from "Trading212" to "Accounts" (comment updated)

### #571 — Automation Dashboard full-width
- **File:** `src/pages/automation-dashboard.css`
- **What:** Changed `.ad-page` from `max-width: var(--page-max-width, 1400px)` to `max-width: none`

### #572 — Automation Overview: health counter + rename Broker→MT5
- **File:** `src/pages/AutomationOverviewPage.jsx`
- **What:**
  - Health counter: `"X/Y healthy"` → `"X healthy / Y total"` for clarity
  - Broker card: `"Broker: MT5"` → `"MT5"` (removed "Broker:" prefix)

## Files Changed
| File | Change |
|------|--------|
| `src/core/nav-tree.js` | Promoted trading-plans, renamed Trading212→Accounts |
| `src/pages/trading-plans-page.css` | Sidebar 280px, overflow hidden, min-width:0 |
| `src/App.jsx` | +🧮 Calculators button in topbar |
| `src/index.css` | +.topbar-calc-btn style |
| `src/components/ScreenOptions.jsx` | Removed "C" calculator button |
| `src/pages/automation-dashboard.css` | max-width: none |
| `src/pages/AutomationOverviewPage.jsx` | Health counter clarity, Broker→MT5 |

## Verification
- ✅ Frontend build passes
