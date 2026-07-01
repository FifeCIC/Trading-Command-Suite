# Pattern Scanner — Real Data, Bar Display & Chart Integration

Status: discussion + later-phase enhancement
Created: 2026-06-30

## Current State
- Fascinating view but confusing
- Set to 1H timeframe — likely demo data
- "Bar" numbers have duplicates — unclear what they mean
- Boxes shift position rapidly — hard to follow
- "Bar 1" is rarely the first box

## Immediate Questions

### 1. Data Source
- [ ] Is the pattern scanner running on real data or demo?
- [ ] If demo: remove and show "Connect MT5 for real pattern detection"
- [ ] Pattern detection requires real candle data — do we have it?

### 2. Bar Number Explanation
- [ ] Why are there duplicates in the Bar column?
- [ ] Why is "Bar 1" rarely first?
- [ ] Need to understand and document the bar numbering logic
- [ ] This might be a bug, or it might be working correctly but unexplained

## Vision: Chart + Patterns Underneath

The ideal view:
1. TradingView chart (or our chart) on top — showing real candles
2. Detected patterns appear BELOW the chart as cards
3. Multiple patterns in a row for the current visible chart range
4. Zoom out → more candles → more pattern cards appear
5. Click a pattern card → scroll chart to that candle

This is a **later-phase enhancement** — complex to build but the right vision.

## View Modes Experiment
User suggests trying different layouts:
- [ ] Current grid view (boxes)
- [ ] List view (scrollable cards)
- [ ] Chart + patterns beneath
- [ ] Timeline-style horizontal scroll

## Questions For You

1. **Real vs. demo**: Should I investigate the backend pattern detection to confirm data source?

2. **TradingView for patterns**: Is the vision of TradingView chart + patterns underneath worth pursuing now, or should we fix the current view first?

3. **Which patterns matter most?** Candlestick patterns (doji, engulfing, hammer), chart patterns (head & shoulders, triangles), or both?
