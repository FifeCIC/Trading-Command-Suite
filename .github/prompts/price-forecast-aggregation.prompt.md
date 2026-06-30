# Price Forecast — Multi-Source Aggregation & Scoring

Status: discussion
Created: 2026-06-30

## Current State
Page doesn't work. No forecast data displayed.

## The Goal
Gather price forecasts from strong sources, create curated averages, and score on them. This is a directive input — a directive could check: "Is the current price significantly below the curated forecast? → bullish signal."

## Clear Actions

### 1. Data Sources for Price Forecasts
What sources to aggregate:
- [ ] Analyst price targets (Finnhub, FMP, Yahoo Finance)
- [ ] Consensus estimates (multiple sources averaged)
- [ ] Options-implied price ranges (if available)
- [ ] Technical projection (fibonacci extensions, measured moves)

### 2. Curated Average Formula
How to calculate our own average:
- Simple mean of all analyst targets
- Trimmed mean (exclude top/bottom 10%)
- Source-weighted (credibility-adjusted)
- Time-decayed (recent forecasts weighted more)
- Confidence interval (not just a single number — range with probability)

### 3. Scoring Integration
A directive could score:
- Current price / forecast price ratio
- How many analysts revised UP recently
- Forecast dispersion (tight consensus = higher confidence)
- Price relative to low/high estimate range

## Questions For You

1. **Which sources do we currently have access to?** Finnhub has fundamentals=true. Any others configured for analyst data?

2. **Forecast display**: Single number with confidence range, or a distribution chart showing all analyst targets?

3. **Update frequency**: Analyst targets change slowly (weekly/monthly). Should we cache aggressively?
