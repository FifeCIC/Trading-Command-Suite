## Source

`/education/candle-patterns-guide`

## Problem — Full Overhaul Needed

The styling is completely out of sync. If there isn't a formalized leading theme yet, use this as the opportunity to establish one from the Theme Lab.

### 1. Thinner candles
The TradingView chart candles are too thick.

### 2. Chart size
Reduce chart size by ~15%. Position text to the left of the chart (e.g., "Pattern Overview" heading).

### 3. Pattern preview SVGs
The SVG previews don't look like the chart examples and are unclear due to grey backgrounds.
```html
<svg>805</svg>
```

### 4. Single-chart approach (A/B test)
Alternative design: one chart (~2× preview size). When a pattern is clicked, the detail information appears below — no second chart needed. This may be the better UX. A/B test in the Lab first.

## Expected

1. Full styling overhaul using Theme Lab design
2. Thinner candles on TV chart
3. Chart size -15%, text repositioned left
4. Fix or replace pattern preview SVGs
5. Prototype single-chart approach for A/B testing
