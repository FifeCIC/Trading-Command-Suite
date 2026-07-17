# Agent Handoff — CenterPicker Component + QA Testing Integration

**Date:** 2026-07-17
**Issue:** #323 (UI/UX Review) — QA Testing area filter overflow fix

---

## What was done

Created a reusable **CenterPicker** component — a horizontal snap-scroll selector where the center-aligned item is the active value. Replaced the overflowing Area filter buttons on the QA Testing page with it. Added a live demo to the Theme Lab.

### New files

1. **`src/components/CenterPicker.jsx`** — Reusable component
   - Props: `items` (array of `{id, label, icon?}`), `value`, `onChange`, `visibleCount` (default 5), `className`
   - CSS snap-scroll with center detection via scroll position math
   - Arrow buttons for left/right navigation (disabled at bounds)
   - Vertical accent-color indicator line at center
   - Active item scales up (1.08×), inactive items are dimmed (0.45 opacity, 0.88× scale)
   - Keyboard accessible via aria roles (listbox/option)
   - Padding slots at edges allow first/last items to reach center position

2. **`src/components/center-picker.css`** — Component styles
   - Uses CSS custom properties: `--ink-soft`, `--accent`, `--panel`, `--line`
   - Snap-scroll via `scroll-snap-type: x mandatory` + `scroll-snap-align: center`
   - Hidden scrollbar (WebKit + Firefox + IE)
   - Smooth scroll behavior

### Modified files

3. **`src/pages/QATestingPage.jsx`**
   - Imported `CenterPicker`
   - Replaced Area filter button row with `<CenterPicker items={AREAS.map(...)} value={areaFilter} onChange={setAreaFilter} visibleCount={5} />`

4. **`src/pages/qa-testing.css`**
   - Added `.qa-filter-area { flex: 1; min-width: 0; }` to let the picker take available width

5. **`src/pages/ThemeLabPage.jsx`**
   - Added `CenterPicker` import + demo state (`pickerValue`)
   - Added "CenterPicker — Snap-Scroll Selector" section at bottom with live demo, usage snippet, and selected value display

6. **`src/pages/theme-lab.css`**
   - Added `.tl-intro`, `.tl-picker-demo`, `.tl-picker-value` styles

### How it works

```
┌──────────────────────────────────────────────┐
│ ‹  [Dim] [Dim] [ACTIVE] [Dim] [Dim]  ›     │
│              │ (center indicator)            │
└──────────────────────────────────────────────┘
```

- Items scroll horizontally; center-detection fires on scroll-end (80ms debounce)
- Clicking any item scrolls it to center
- Arrow buttons move one step at a time
- `visibleCount` controls how many items fit in the viewport — items size to `100/visibleCount %`
