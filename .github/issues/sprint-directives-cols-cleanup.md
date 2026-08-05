## Source

`/scoring/directives-manager`

## Problem

The directives table has three columns that should be removed or relocated:

1. **Complexity** — move this value into the `<aside.directive-detail-rail>` sidebar instead
2. **Readiness** — move this value into the sidebar as well
3. **Class** — delete this column entirely, don't add it to the sidebar

## Expected

- Remove `<th>Complexity</th>` column — display the value in the detail sidebar rail
- Remove `<th>Readiness</th>` column — display the value in the detail sidebar rail
- Remove `<th>Class</th>` column — delete entirely

## Elements

Columns to delete/move:
```html
<th>Complexity</th>
<th>Readiness</th>
<th>Class</th>
```

Values should appear here instead (for Complexity and Readiness only):
```html
<aside class="directive-detail-rail" aria-label="Selected directive details">
  RSI Oversold Reversion  active  Defaults  Priority  5  Weight  85  Formula  ...
</aside>
```
