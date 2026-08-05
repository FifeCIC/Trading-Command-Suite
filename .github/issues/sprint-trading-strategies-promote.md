## Source

`/trading/trading-strategies`

## Problem

This is a good view with a well-organized layout covering complex data. But:
1. It's stuck in the "— Legacy Strategy Pages —" menu section
2. Columns aren't sortable

## Expected

### Menu
Move Trading Strategies to the **top section** of the Trading menu — out of Legacy.

### Sortable columns
Make ALL columns sortable (click header to sort asc/desc). Start with:
```html
<th>Active</th>
```

## Note

There's an ambiguous second entry in SPRINT.md that says "Delete this view" referencing `<th>Active</th>` at the same route. This contradicts the earlier instruction to keep and promote it. Clarification needed: does this mean delete the Active column, or is this a duplicate/errant entry?
