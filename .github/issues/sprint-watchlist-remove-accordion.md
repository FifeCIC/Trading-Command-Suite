## Source

`/watchlists/user-watchlists`

## Problem

1. The watchlist list items use an accordion pattern that expands to show symbol count and dates — this is unnecessary complexity. Remove the accordion.
2. The delete button (🗑️) is on each list item. It should be moved into the detail pane (right sidebar) instead.

## Expected

- Remove the accordion expand/collapse from `.wl-list-item.wl-selected`
- Move the delete button from the list item to the detail pane (`<aside.wl-detail-pane>`)

## Elements

Remove accordion from:
```html
<div class="wl-list-item wl-selected">
  forex majors  7 symbols  file▴  🗑️  Imported 16 Jul 2026
</div>
```

Move delete button:
```html
<button class="wl-delete-btn" title="Delete watchlist">🗑️</button>
```

To the detail pane:
```html
<aside class="wl-detail-pane">
  forex majors  7 symbols  EURUSD✕  GBPUSD✕  USDJPY✕  ...
</aside>
```
