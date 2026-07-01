# Volatility Analysis — How Is Volatility Expressed & Visualised?

Status: discussion
Created: 2026-06-30

## Current State
Page appears broken — nothing works. User notes: "I'm not entirely sure how volatility is expressed."

## Discussion Points

### 1. How to Express Volatility
Volatility can be expressed in multiple ways:
- **ATR (Average True Range)**: Absolute price movement in dollars/pips — "NVDA moves ±$5.20 per day on average"
- **Bollinger Bands**: Visual envelope around price — width = volatility
- **Historical Volatility (HV)**: Annualised standard deviation of returns — "30-day HV = 35%"
- **Implied Volatility (IV)**: Options-market expectation — "NVDA IV Rank: 82nd percentile"
- **VIX / VIX-like**: Market-wide fear gauge
- **Beta**: Relative volatility vs. benchmark

Which of these should the page focus on?

### 2. Visual Progress
User wants visual progress:
- [ ] At minimum: a line chart of ATR or HV over time
- [ ] Better: Bollinger Bands on a price chart
- [ ] Best: All indicators on a single chart with toggle

### 3. Scoring Directives That Use Volatility
Existing volatility-related directives:
- `volatility-regime` (Risk group)
- `bollinger-squeeze` (Technical group)
- `atr-expansion` (Technical group)
- `bollinger-pct-b` (listed in providers/MT5 indicators)

## Questions For You

1. **Primary volatility metric**: ATR (absolute movement) or HV (percentage-based)? They serve different purposes — ATR for position sizing, HV for regime detection.

2. **Visual approach**: Single metric chart or multi-indicator chart with toggles?

3. **Real data**: If the page uses demo data, should we remove demo and show "No data — connect MT5 for real volatility data"?
