# RUI009 — Chart Comparison (Protocol A/B Testing)

**Agent:** react-ui-agent
**Area:** Analysis / Scoring
**Priority:** P2 — validates protocol relative performance
**Depends on:** Lightweight Charts (installed), Market data adapters

## Current State
`ChartComparisonPage.jsx` is mock — not yet built.

## Task

### Side-by-Side Protocol Comparison
- Select two protocols (e.g., "AI Titans" vs "Tech Momentum")
- Select a symbol
- Show two synchronized candlestick charts with protocol signals overlaid
- Entry/Watch/Exit markers on each chart at the exact candle where the signal fired
- Performance metrics: total signals, win rate, hypothetical P&L per protocol

### Diff View
- Heatmap table: which candles got different signals from the two protocols?
- "At candle 47, AI Titans said ENTRY, Tech Momentum said WATCH — why?"
- Expand to see directive-by-directive comparison

### UI Guidance

**Layout:** Two synced charts side by side (50/50 split)

**Visual styling:**
- Charts scroll in sync — panning one pans the other (linked timeScale via Lightweight Charts API)
- Signal markers: animated entrance with `motion` — entry=green triangle, watch=amber circle, exit=red triangle
- Protocol labels: color-coded headers with protocol name + timeframe
- Diff heatmap: CSS grid with colored cells. Green = agreement, red = disagreement. Hover tooltip shows details.
- Hypothetical P&L counter: large animated number with `motion` spring — counts up on load

**Transitions:**
- Protocol switch: chart data crossfades (View Transitions API works here too for the container)
- Diff row expansion: accordion pattern from Motion Lab
- P&L counter: uses `useSpring` from `motion` for number counting animation

**Interactive:** Click any signal marker to see the full directive breakdown at that moment. Panel slides up from bottom.
