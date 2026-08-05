## Source

`/trading/strategies-index` — `<span.ts-slider>`

## Problem

1. The toggle slider is visually a mess — it's not a circle, not a pill, just an undefined shape
2. Clicking the toggle takes ~5 seconds to respond — this might be legitimate (waiting for strategy to stop) but should be investigated for faults

## Expected

- Redesign the toggle as either a clean **circle** or a **pill-shaped** toggle switch
- This is an opportunity to use the Theme Lab or improve it — check if the Theme Lab has toggle variants; if not, add them
- Investigate the 5-second delay — if it's backend processing time (strategy stop/start), add a loading/processing indicator so the user knows something is happening

## Element

```html
<span class="ts-slider"></span>
```
