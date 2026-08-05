# Handoff: SPRINT Batch 1 — UI Quick Fixes (#544–#549)

**Date:** 2026-08-04
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Implemented 6 quick UI fixes from the SPRINT.md document.

## Changes

### #544 — Breadcrumbs theme mismatch
- **File:** `src/index.css`
- **What:** Replaced hardcoded dark colors (`#1e293b`, `#334155`, `#1a2340`, `#273348`) with CSS variables (`var(--panel)`, `var(--line)`, `color-mix(...)`)
- **Impact:** Breadcrumbs now follow the active theme (light/dark). Arrow connectors, pill backgrounds, hover states, and current-pill all theme-aware.

### #545 — Pip-trigger (ℹ) circular button with modern hover
- **File:** `src/components/page-info-popover.css`
- **What:** Enlarged button (22→26px), added scale(1.1) + glow box-shadow on hover, accent-tinted background on hover
- **Impact:** All views using `<PageInfoPopover>` get the improved button. Already circular (border-radius: 50%), now more visually polished.

### #546 — T212 All/Live/Practice toggle
- **Files:** `src/pages/T212PortfolioPage.jsx`, `src/pages/t212-portfolio.css`
- **What:** Added `accountFilter` state ('all'|'live'|'practice') with segmented toggle bar between header and account summary
- **Note:** Toggle is UI-only for now — positions don't have accountType field in current data. Wired for future filtering.

### #547 — T212 Avg Price column fix
- **File:** `src/pages/T212PortfolioPage.jsx`
- **What:** Changed `p.averagePrice` → `p.avgPrice` (line ~165)
- **Root cause:** Prisma model field is `avgPrice`, frontend was looking for `averagePrice` — always returned undefined

### #548 — QA filters compact into dropdown
- **Files:** `src/pages/QATestingPage.jsx`, `src/pages/qa-testing.css`
- **What:** Replaced 3 rows of filter buttons with 3 `<select>` dropdowns (Area, Priority, Status)
- **Impact:** Much more compact, no wrapping issues

### #549 — Remove QA feedback textarea
- **File:** `src/pages/QATestingPage.jsx`
- **What:** Removed `<textarea>`, "Save Note" button, `feedbackText` state, and `saveFeedback` function
- **Bug fix:** `cycleStatus` function body was accidentally deleted during replacement — restored

## Files Changed
| File | Change |
|------|--------|
| `src/index.css` | Breadcrumb colors → CSS variables |
| `src/components/page-info-popover.css` | Pip-trigger size + hover effects |
| `src/pages/T212PortfolioPage.jsx` | +toggle bar, fix avgPrice→avgPrice |
| `src/pages/t212-portfolio.css` | +toggle bar styles |
| `src/pages/QATestingPage.jsx` | Filters→selects, -feedback form, fix cycleStatus |
| `src/pages/qa-testing.css` | Select styles replace button styles |

## Verification
- ✅ Frontend build passes
- ✅ NestJS backend build passes
- ✅ No lint errors
