# Support & Resistance — Fast Working Version, Directive Audit & Strategy Packaging

Status: action + discussion
Created: 2026-06-30
Priority: HIGH (user wants this working very soon)

## Current State
Page appears broken — no selections produce visible results.

## Clear Actions

### 1. Get It Working Fast
The fastest path to genuine S&R analysis:
- [ ] Compute swing highs/lows from real OHLC data
- [ ] Display as a numbered table: Level | Price | Type (support/resistance) | Strength (touches) | Last Tested
- [ ] Add a simple chart overlay showing horizontal S/R lines — use lightweight-charts
- [ ] Start with 1D timeframe, add more later
- [ ] This can work without TradingView — lightweight-charts already supports horizontal line markers

### 2. Video-Like Playback Mode
- [ ] Play through historical data candle by candle
- [ ] Show S/R levels forming and breaking in real-time
- [ ] Record results over a period, compare to reality
- [ ] This is forward-training: did the identified support actually hold?

### 3. Benchmark Against Other Tools
- [ ] Compare our S/R detection against: TradingView auto-S/R, manual analysis, known pivot point formulas
- [ ] Calculate accuracy: how often did our support/resistance levels hold?
- [ ] Display comparison metrics

## Discussion Points

### 1. Directive Dependency Audit
How many scoring directives and trading strategy directives require S&R data?
- `support-resistance` directive (exists in DIRECTIVE_GROUPS)
- Any others that implicitly use S/R (price action, pattern detection)?
- This determines how critical S&R accuracy is to overall scoring

### 2. Trading Style Suitability
Which trading types rely most heavily on S&R?
- Scalping (1m-5m): quick S/R flips, order blocks
- Intraday (15m-4H): key levels, breakout/breakdown
- Swing (4H-Daily): major zones, multi-touch levels
- Position (Weekly+): structural S/R, multi-year levels

### 3. Strategy Packaging
When we strengthen tools good for certain trading types and symbols:
- Make it clear in the app that "this combination is a good strategy"
- Capture it in a Scoring Strategy (watchlist + protocol)
- Run it with strong intent via the automation system
- This connects analysis → strategy → automation

## Questions For You

1. **Visual preference**: Do you want both a numbered table AND a chart overlay, or just one?

2. **S&R methodology**: Pivot points (standard formula)? Swing high/low detection? Volume profile nodes? Order block detection? Which approach first?

3. **Accuracy tracking**: Worth building a system that tracks S&R accuracy over time?
