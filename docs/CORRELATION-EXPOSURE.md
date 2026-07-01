# GitHub Issue: Correlation Matrix & Exposure Analysis

## Why This Gives an Edge
Five strategies running simultaneously on EURUSD, GBPUSD, EURGBP, USDCHF, and EURJPY might look diversified. But if EURUSD and GBPUSD have 0.87 correlation, you're not diversified — you're 2x leveraged on the same theme. One bad USD move hits everything.

## What to Implement

### Correlation Matrix
- Pearson correlation between all traded symbols
- Rolling 90-day window, updated daily
- Heatmap visualization: green (negative corr), red (positive corr)
- Flag: "EURUSD + GBPUSD = 0.87 — reduce combined exposure"

### Net Exposure Analysis
- Per currency: net long/short EUR across all positions
- Per sector: tech stocks, energy, financials
- Per asset class: forex, stocks, crypto, commodities
- "Net long 2.3 lots EUR, net short 0.8 lots USD"

### Strategy Correlation
- Two strategies on different symbols might still correlate
- Strategy A (EURUSD trend) + Strategy B (GBPUSD trend) = 0.82 correlation
- Combined drawdown risk if both fail simultaneously

### Concentration Risk
- "Portfolio is 45% technology stocks"
- "3 of 5 open positions are long USD"
- Flag when any single exposure > 30%

### Value at Risk (VaR)
- 95% confidence: "Maximum daily loss: $234 (5% probability of exceeding)"
- 99% confidence: "Maximum daily loss: $412 (1% probability of exceeding)"
- Historical VaR (actual worst days) vs Parametric VaR (statistical model)

## Integration
- New page: /portfolio/exposure
- Top strip on Portfolio Overview
- Warning notifications when concentration exceeds thresholds
- Correlation matrix integrated into Strategy Competition (Q157)

## Labels
enhancement, risk, portfolio, P1

## Priority
P1 — prevents correlated blow-ups
