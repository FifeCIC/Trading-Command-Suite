# Batch 2: Issues #546–#550 — Watchlists, Directives, Strategies, Sliders, Counters

**Date:** 2026-08-04  
**Agent:** Copilot (DeepSeek V4 Pro)  
**Build:** ✅ Frontend (2953 modules) + Backend (tsc) both clean

---

## #546 — Watchlists: Faded Checkboxes, Remove Accordion, Move Delete

### Changes
- **`src/pages/trading-platforms.css`**: Added `opacity: 0.55` (0.85 when checked) to `.tp-col-option input[type="checkbox"]` and `.tp-comparison-table input[type="checkbox"]` for faded checkbox appearance on Active Symbols page.
- **`src/pages/UserWatchlistsPage.jsx`**: 
  - Removed `AnimatePresence` import (no longer needed).
  - Simplified `handleSelect` from toggle to straight select (clicking always selects, never deselects).
  - Removed `▴/▾` chevron from `wl-list-meta`.
  - Removed the accordion expansion (`wl-list-detail`) containing importedAt date and auto-sync status.
  - Replaced with static `wl-list-date-row` that shows importedAt without animation when selected.
  - Removed delete button from list items.
  - Added `wl-detail-header-row` with delete button in the right detail pane header.
- **`src/pages/watchlists.css`**: Added `.wl-detail-header-row` (flex between title and delete), `.wl-list-date-row` (static date display), `.wl-delete-btn` (red outlined button, fills red on hover). Updated `.wl-detail-content h3` specificity.

### Reason
User wanted a simpler watchlist UI: no expand/collapse accordion, checkboxes visually de-emphasized, and delete action moved to the detail panel where it's contextually appropriate.

---

## #547 — Directives Manager: Remove Class/Readiness/Complexity Columns, Move to Sidebar

### Changes
- **`src/pages/DirectivesManagerPage.jsx`**:
  - Removed `<th>Class</th>`, `<th>Readiness</th>`, `<th>Complexity</th>` from table header.
  - Removed corresponding `<td>` cells from each row (classification, readiness, complexity).
  - Added `.directive-detail-meta-row` in the sidebar header with Readiness badge (colored pill per tier) and Complexity badge (outlined label).
- **`src/pages/directives-manager.css`**: Added `.directive-detail-meta-row` (flex row of badges) and `.directive-detail-badge` (small pill style).

### Reason
User found these columns unnecessary in the table. Readiness and Complexity are more useful in the sidebar detail view where you're inspecting a single directive. Class was removed entirely as requested.

---

## #548 — Strategy Faulty Filter + Fault Banner

### Changes
- **`src/pages/StrategiesListPage.jsx`**:
  - Added `'faulty'` to filter state options: `all | active | trading | scoring | faulty`.
  - Added `faultyStrategies` memo: filters strategies where `dataStatus !== 'ready'` (pending_bars or blocked).
  - Added `if (filter === 'faulty')` to filter logic: shows only strategies with data issues.
  - Added faulty warning banner between header and grid: shows count of faulty strategies with "View faulty" button (hidden when already on faulty filter).
  - Made `handleToggle` fire-and-forget (no await on response) to fix 5-second click delay.
- **`src/pages/strategies-list.css`**:
  - Added `.sl-filter-active.sl-filter-faulty` for red-tinted active filter chip.
  - Added `.sl-faulty-banner` (red-tinted alert banner) and `.sl-faulty-banner-btn` (pill button).
  - The faulty filter chip gets `sl-filter-faulty` class for red styling.

### Reason
User identified that strategies stuck in `pending_bars` (e.g., SPX500 not available in MT5) have no visibility. The faulty filter surfaces these immediately. The banner acts as a soft notification — it appears whenever faulty strategies exist, with a one-click filter.

---

## #549 — Sliders: Toggle Switch + Directive Sliders

### Changes
- **`src/components/toggle-switch.css`**:
  - Changed `.ts-slider` background from hardcoded `var(--color-text-dim, #475569)` to `var(--line, #334155)` for theme compatibility.
  - Slightly enlarged: 36→38px wide, 20→22px tall, knob 14→16px.
  - Added `box-shadow: 0 1px 3px rgba(0,0,0,0.2)` to knob for depth.
  - Adjusted small variant proportionally: 28→30px wide, 16→18px tall.
- **`src/pages/StrategiesListPage.jsx`**: `handleToggle` now fire-and-forget (see #548) — no 5-second await.
- **`src/pages/directives-manager.css`**:
  - Fixed both `.directive-slider` rule sets: changed `background: rgba(255,255,255,0.08)` → `background: var(--line, #334155)` for visibility in light mode.
  - Increased track height from 4px → 6px for better visibility.

### Reason
The toggle slider background used a CSS variable that didn't resolve in all themes, causing visual breakage. Directive sliders used a hardcoded near-white color invisible in light mode. Now both use `--line` which adapts to theme.

---

## #550 — Directives Counter: Fix Protocol Count

### Changes
- **`nest/src/modules/directives/directives.controller.ts`**: Removed `distinct: ['directiveId']` from the `protocolDirectiveEntry.findMany()` query.

### Root Cause
The `distinct` clause caused Prisma to return only one row per `directiveId`, so every directive always had `protocolCount: 1` (or 0). Without `distinct`, all rows are returned and correctly counted, so a directive in 3 protocols shows `protocolCount: 3`.

### Reason
User noticed no directives had counts of 2 or more. The distinct was preventing proper counting.

---

## Files Changed
| File | Change |
|------|--------|
| `src/pages/UserWatchlistsPage.jsx` | Accordion removal, delete moved to detail pane |
| `src/pages/watchlists.css` | New header-row, date-row, delete-btn styles |
| `src/pages/ActiveSymbolsPage.jsx` | No changes (CSS only for checkboxes) |
| `src/pages/trading-platforms.css` | Faded checkbox opacity rules |
| `src/pages/DirectivesManagerPage.jsx` | Removed 3 columns, added meta-row in sidebar |
| `src/pages/directives-manager.css` | Slider background fix, meta-row/badge styles |
| `src/pages/StrategiesListPage.jsx` | Faulty filter, faulty banner, optimistic toggle |
| `src/pages/strategies-list.css` | Faulty filter chip + banner styles |
| `src/components/toggle-switch.css` | Theme-var background, enlarged, knob shadow |
| `nest/src/modules/directives/directives.controller.ts` | Removed `distinct` from protocolCount query |
