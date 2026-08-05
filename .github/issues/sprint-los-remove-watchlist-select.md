## Source

`/scoring/live-ordering-stack` — `<select.los-select>`

## Problem

The Live Ordering Stack view has a Watchlist selector dropdown, but the system was changed so that a protocol is now paired with a watchlist in order to run. The watchlist selector is redundant — only the protocol selector is needed.

## Expected

Remove the watchlist `<select>` element entirely. Keep only the protocol selector.

## Element to remove

```html
<select class="los-select">
  Trading212 Portfolio (9)
  test-watchlist (3)
  test-indices (1)
  test-gold (1)
  ...
</select>
```
