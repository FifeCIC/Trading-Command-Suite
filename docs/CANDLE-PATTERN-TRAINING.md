# GitHub Issue: Candle Pattern Training Area

## Why This Gives an Edge
Trust comes from seeing. A directive that says "doji detected" is abstract. Seeing the doji highlighted on a chart, with an explanation of what it means and how often it was right, builds confidence in the system. Plus it's genuinely fun to scroll through charts seeing patterns light up.

## What to Build

### The Training Area (`/training/candle-patterns`)

**Chart with Pattern Overlay:**
- TradingView Lightweight Charts integration (from Q143)
- Candlestick chart with zoom, pan, timeframe switching
- Pattern detection runs in real-time as you scroll through data
- Detected patterns appear as:
  - Colored markers above/below the candles (icon + label)
  - The forming candles highlighted with semi-transparent overlay
  - Pattern name badge on hover/click
- Pattern types to detect:
  - Doji (dragonfly, gravestone, long-legged)
  - Hammer / Inverted Hammer
  - Engulfing (bullish/bearish)
  - Harami (bullish/bearish)
  - Morning/Evening Star (Three Soldiers)
  - Dark Cloud Cover / Piercing Line
  - Marubozu
  - Shooting Star

**Dual Mode:**
- **Live Mode**: Streams current data from MT5 bridge, patterns detected in real-time
- **Backtest Explorer**: Load historical data, scroll through time, see patterns that fired then. "This doji on Jan 15 preceded a +2.3% move"

**Pattern Details Panel:**
- Click a pattern marker → side panel opens
- Shows: pattern name, Japanese name, reliability stats from directive accuracy tracking
- "This pattern has been correct 62% of the time over the last 200 occurrences"
- Mini educational blurb: "A hammer forms when sellers push price down but buyers reject the low, closing near the open. It signals potential reversal."
- Link to related directive

**Pattern Accuracy Overlay:**
- Toggle: "Show accuracy" — colors patterns by historical success rate
- Green = >65% accurate, Yellow = 50-65%, Red = <50%
- Uses Q215 directive accuracy tracking data

**Fun Elements:**
- Pattern counter: "You've spotted 47 dojis today"
- Achievement-style unlocks: "Pattern Master: Identified all 12 major candlestick patterns"
- Streak tracking: "5 correct engulfing calls in a row"
- Pattern heatmap calendar: which days had the most patterns?

### Integration with Existing Directives
- Uses the same pattern directives already in the codebase (doji-pattern, engulfing-pattern, hammer-pattern, etc.)
- The training area calls the directive calculate() method and visualizes the result
- Pattern detection is identical to what the scoring pipeline uses — what you see here IS what feeds into your trading signals

## Labels
enhancement, training, frontend, P1

## Priority
P1 — builds trust, is fun, and uses directives that already exist
