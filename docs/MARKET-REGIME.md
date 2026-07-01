# GitHub Issue: Market Regime Detection & Adaptive Strategy Selection

## Why This Gives an Edge
A mean-reversion strategy works brilliantly in ranging markets and gets destroyed in trending markets. A trend-following strategy is the opposite. Without regime detection, you're running the wrong strategy at the wrong time.

## What to Implement

### Regime Classification
- Use Hurst Exponent: H > 0.6 = trending, H < 0.4 = mean-reverting, 0.4-0.6 = random
- Use ADX: > 25 = trending, < 20 = ranging
- Use volatility percentile: high vol = avoid mean-reversion
- Weighted ensemble of multiple regime indicators

### Adaptive Strategy Selection
- "Market is trending → activate Trend Following, pause Mean Reversion"
- "Market is ranging → activate Mean Reversion, pause Trend Following"
- "Volatility extreme → reduce all position sizes by 50%"
- Automatic or manual confirmation

### Regime Calendar
- Visual calendar showing each day's dominant regime
- Overlay: which strategies were active, how they performed
- Pattern: "This strategy works in trending markets on Tuesdays"

### Regime Transition Alerts
- "Market shifting from ranging to trending — prepare to switch strategies"
- "Volatility expanding — consider reducing exposure"
- Based on statistical break from recent regime

## Integration
- Regime indicator bar at top of SEES Live Stack
- Color-coded: green (trending), yellow (ranging), red (volatile/chaotic)
- Strategy status: "Active ✓ (regime compatible)" or "Paused ⏸ (wrong regime)"
- New directive: market-regime-filter (pass-through weighting)

## Labels
enhancement, strategy, risk, P1

## Priority
P1 — right strategy at wrong time = guaranteed losses
