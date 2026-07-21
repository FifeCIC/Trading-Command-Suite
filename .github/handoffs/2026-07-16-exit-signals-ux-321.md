# Exit Signals — UX Polish (#321)

**Date:** 2026-07-16
**Issue:** #321 — UI/UX: Exit Signals grouping, card redesign, Notice component, missing broker/source info

## What Was Already Done
- Notice component was already imported and used for warning banner
- Position cards already had uniform thin borders (no left-accent)
- Positions were already grouped by urgency level with colored headers
- Source/broker badges already existed in the markup

## What Was Fixed

### 1. Text Sizes Increased
- Header: `1.35rem` → `1.5rem`
- Symbol: `1.1rem` → `1.15rem` with `letter-spacing: 0.02em`
- Metric values: `0.9rem` → `0.92rem`
- Metric labels: `0.72rem` → `0.7rem` with `font-weight: 600` and `letter-spacing: 0.05em`
- Empty state text: increased to `1rem`
- Legend: `0.75rem` → `0.78rem`

### 2. Visual Hierarchy
- Group headers now have `border-left: 3px solid` color accents (red/orange/blue/green/gray) for instant status recognition
- Background tint on group headers deepened slightly
- Reasons section now has `rgba(0,0,0,0.08)` background tint + padding for visual separation
- Cards have `flex-direction: column` with consistent `gap`

### 3. Source/Broker Always Visible
- Changed from conditional rendering (only showing badges when data exists) to ALWAYS showing badges
- Color-coded: purple (`es-source-app`) for app source, green (`es-source-broker`) for broker, red (`es-source-missing`) when data missing
- Shows "Unknown Source" / "Unknown Broker" with italic style when data unavailable

### 4. Notice Component Fixed
- Removed invalid `title` prop from `<Notice>` (component doesn't accept it)
- Restructured to use `<strong>` in children for the title text

### 5. Card Polish
- Added `box-shadow` on hover for depth
- Increased min card width from `300px` to `320px`
- Wider metric gap: `1rem` → `1.25rem`

### 6. Responsive Improvements
- Added `@media (max-width: 640px)` breakpoint for mobile
- Single-column grid on mobile, reduced metric gaps

## Files Changed
| File | Change |
|------|--------|
| `src/pages/exit-signals.css` | Complete CSS rewrite: larger text, group header accents, source/broker color coding, responsive breakpoint, hover shadow, wider spacing |
| `src/pages/ExitSignalsPage.jsx` | Fixed Notice prop, always-show source/broker with color-coded badges, replaced inline style with `es-actions-row` class |
