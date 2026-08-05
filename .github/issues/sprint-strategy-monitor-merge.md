## Source

Two views to consolidate:

### Strategies Index (`/trading/strategies-index`) — TO BE DELETED
- File: `src/pages/StrategiesListPage.jsx`
- Has: Filterable card index with profitRatio display, filter bar (All/Active/Trading/Scoring), toggle sliders

### Strategy Monitor (`/trading/strategy-monitor`) — TO BE KEPT + EXPANDED
- File: `src/pages/StrategyMonitorPage.jsx`
- Has: Tabbed hub (Overview/Compare/Ladders)

## Problem

The new views and merge attempt didn't work. The user likes the card layout from Strategies Index but wants it all in Strategy Monitor.

## Expected

1. **Copy the card layout** from Strategies Index into Strategy Monitor — show ALL strategies using the card design
2. **Copy the filters** from Strategies Index (All/Active/Trading/Scoring + toggle sliders)
3. **Delete** Strategies Index page, route, nav entry, and CSS
4. Strategy Monitor becomes the single canonical trading strategies view

## Elements to preserve (from Strategies Index)

Card design:
```html
<div class="sl-card">
  US SPY Speed  Trading  SPX500  spy-day-v1  mt5
</div>
```

Filter bar:
```html
<div class="sl-filter-bar">
  All  Active  Trading  Scoring
</div>
```
