## Source

`/lab/triple-screen`

## Problem

The current Triple Screen concept shows 3 placeholder columns with fixed sizes that shrink when the window is resized. The user wants two distinct layouts:

### Layout A: META.Stack Pipeline
- Each step of the META.Stack pipeline gets its own column
- Fixed sequence: Market Context → Scoring → Signals → Decisions → Execution → Positions
- This is a **pipeline view** — data flows left to right

### Layout B: Modular Widget Grid
- Widget-based, drag-and-drop grid approach (closer to current design)
- Flexible arrangement, not locked to pipeline order

## Requirements (both layouts)

- **6+ columns** minimum (may expand to 9)
- **Percentage-based widths** — different columns may have different widths depending on content
- **Minimum widths** per column to prevent content from becoming unreadable
- **Horizontal scroll** when content overflows (header already scrolls, columns should too)
- **Fill the content area** — use full `<main#main-content.main-stage>` width

## Entry points

Add buttons on the current Triple Screen page to open:
- "Pipeline View" → Layout A (new window)
- "Widget Grid" → Layout B (new window)

## Dependency

After this is built and the Market Context content is verified as available in the pipeline view, delete:
- `/trading/market-context` page (covered by separate issue)

## Element

Current layout:
```html
<div class="ts-panel-placeholder">Screen Left — Watchlists, positions, account summary</div>
<div class="ts-panel-placeholder">Screen Center — Charts, price action, DOM, time and sales</div>
<div class="ts-panel-placeholder">Screen Right — ...</div>
```
