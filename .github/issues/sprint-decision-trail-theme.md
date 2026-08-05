## Source

`/automation/decision-trail`

## Problem

### 1. Theme mismatch
Decision trail cards are not inline with the current theme/mode:
```html
<div class="dt-trail-card">
  EURUSD  SCORED  0  forex-majors × mt5-technical-core-v1: long=NaN...
</div>
```

### 2. Accordions unnecessary?
The accordion pattern doesn't hide much content and there are duplicate values. However, it may have been designed for entries expected to have more content in the future.

**Before removing:** Check if future entries (full META.Stack pipeline) will have significantly more data that justifies accordions.

### 3. Completeness bar all 0%
```html
<div class="dt-completeness-bar">
  Pipeline Completeness  🎯0%  ⚖️0%  🧠0%  ⚡0%  🛡️0%  🏁0%  0/20 trails complete
</div>
```

Is there actual functionality backing these stats, or is it waiting on the full META.Stack pipeline? Investigate and either:
- Wire the real data if available
- Hide the bar if the data pipeline isn't ready yet

## Expected

- Sync card styling with current theme
- Evaluate accordion: keep if future entries justify it, remove if not
- Fix or hide completeness bar based on data availability
