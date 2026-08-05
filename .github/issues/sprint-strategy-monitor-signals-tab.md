## Source

`/trading/strategy-monitor`

## Problem

Strategy Monitor has tabs: Overview, Compare, Ladders. Missing a Signals log.

Ladders orders by strength/priority. A Signals tab would be different — a flat chronological log of all scored symbols that passed through scoring strategies' gates.

## Expected

Add a new **Signals** tab to Strategy Monitor that:
- Lists all scored symbols that were passed by scoring strategies
- Chronological order (most recent first)
- Shows: symbol, score, protocol, scoring strategy, timestamp, signal strength
- Different from Ladders tab which ranks by priority

## Element

Existing tabs:
```html
<button class="sm-tab">🪜 Ladders</button>
```

New tab should sit alongside these.
