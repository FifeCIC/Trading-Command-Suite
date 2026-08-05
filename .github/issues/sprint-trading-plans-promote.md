## Source

`/trading/trading-plans`

## Problem

### 1. In wrong menu section
Trading Plans is in the Legacy section. Move it to the upper Trading menu — even if plan entries are only visible for minutes, we need to be able to view them.

### 2. Content overflow
The content area is too large and pushes the right sidebar offscreen:
```html
<div class="plan-detail-content">
  Mon Jun 22 - Triage + NVDA Averaging Plan  Draft  Active  Executed
</div>
```

## Expected

- Move Trading Plans nav entry to the main Trading section (out of Legacy)
- Fix the content area sizing so the right sidebar remains visible
