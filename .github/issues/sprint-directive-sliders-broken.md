## Source

`/scoring/directives-manager` — `<div.directive-slider-row>`

## Problem

1. The priority/weight sliders on directive rows don't work (can't drag/interact)
2. The slider track/background is invisible when light theme is active — the track blends into the white background

## Expected

- Fix slider functionality so values can be changed by dragging
- Ensure slider track is visible in both light and dark themes (add proper contrast)
- Verify the slider values persist correctly after adjustment

## Elements

```html
<div class="directive-slider-row">5</div>
<div class="directive-slider-row">85</div>
```
