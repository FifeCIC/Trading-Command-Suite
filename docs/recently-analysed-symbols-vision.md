# Recently Analysed Symbols — What Constitutes "Analysis" & Vision

Status: discussion
Created: 2026-06-30

## Current State
Skeleton page — not built.

## Discussion Points

### 1. What IS Symbol Analysis?
Before building the page, define what "analysis" means in this app:
- Running scoring directives against the symbol?
- Computing technical indicators (RSI, MACD, SMA)?
- Checking support/resistance levels?
- Reviewing news sentiment and upcoming events?
- Comparing against sector peers?
- Generating a comprehensive report?
- All of the above?

### 2. TradingView Integration
If their API allows chart embedding:
- Display a full TradingView chart on the analysis page
- Overlay our directive results on their chart
- This would leapfrog our charting limitations
- Investigate: does TradingView's Charting Library / Widget API allow this?

### 3. Chart Snapshot Feature (GitHub Issue)
Request: ability to snapshot a chart — capture its STATE, not a screenshot.
- State includes: symbol, timeframe, visible range, indicators, drawings, annotations
- Allows sharing the exact moment being analysed
- Factors into planning, decision making, and timeline
- These snapshots become triggers when zones are hit
- This is a distant ability — plan early, discuss now

### 4. Trading Type & Period Scoping
When analysing a symbol:
- **Option A**: Analyse for ANY opportunity (general health check)
- **Option B**: Analyse for a specific trading type + timeframe (e.g., "scalp NVDA on 5m")
- **Option C**: Both — default to general, with optional scoping

### 5. Swipeable Card View
For touch screens and fast browsing:
- Horizontal sliding cards — one symbol per card
- Swipe to move between recently analysed symbols
- Use latest browser View Transitions API for smooth content swaps
- Especially important for tablet/mobile use

## Clear Actions
- [ ] Define analysis scope (what data + computation = "analysed")
- [ ] Research TradingView Widget API for embedding
- [ ] Create GitHub issue for chart snapshot feature
- [ ] Plan swipeable card view with View Transitions API

## Questions For You

1. **Analysis definition**: Should "analysing" a symbol mean running the full SEES pipeline on it? Or a lighter-weight check?

2. **TradingView**: Should I investigate their API now, or focus on our own charting first?

3. **Card view priority**: Is the swipeable horizontal card view a near-term need or a nice-to-have for later?
