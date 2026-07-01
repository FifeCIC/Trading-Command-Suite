# Technical Indicators — Demo Removal & Single-Chart Toggle

Status: action + discussion
Created: 2026-06-30

## Current State
- Many separate charts showing wavy lines — tells the user nothing useful
- Unclear if data is real or demo
- Demo data is no longer acceptable

## Clear Actions

### 1. Remove Demo Data
- [ ] Audit: is the data real or simulated?
- [ ] If demo/purely synthetic: replace with "No real indicator data available. Connect a data source."
- [ ] Only show indicators computed from genuine market data

### 2. Single Chart with Toggle
Replace multiple separate charts with ONE chart:
- [ ] Use lightweight-charts (already in the project)
- [ ] Display price candles as the base
- [ ] Toggle indicators on/off: RSI panel below, MACD panel, volume bars, EMA/SMA overlay
- [ ] This is essentially a simplified TradingView approach — one clean chart, many overlays

### 3. TradingView Free Chart
User suggests TradingView free chart widget:
- [ ] Investigate: can the TradingView widget accept our data and toggle indicators?
- [ ] If yes, this could solve charting for multiple pages at once
- [ ] Trade-off: less control vs. faster development

## Discussion Points

### 1. Which Indicators Are Useful?
The current page shows many indicators. Which are actually worth surfacing?
- Core: RSI, MACD, EMA, Bollinger Bands, Volume
- Secondary: Stochastic, CCI, ATR, OBV
- For display only, or should each indicator feed a scoring directive?

### 2. Lab Connection
The Charts Lab is building toward TradingView quality. Progress there benefits this page directly. Should we merge the Technical Indicators page into the Charts Lab as another view?

## Questions For You

1. **Real or demo**: Should I check the backend data source for indicators?

2. **Merge into Lab?**: Move Technical Indicators to Lab as an indicator testing ground, rather than a standalone analysis tool?

3. **TradingView widget**: Worth investigating now, or stick with lightweight-charts for the immediate fix?
