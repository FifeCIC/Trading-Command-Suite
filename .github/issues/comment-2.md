## META.Stack Context Update (2026-07-17)

This issue was created early in development. The app now has charting infrastructure worth noting:

### What Already Exists
- **Training area** at /training/candle-patterns — uses TradingView Charting Widget (not lightweight-charts, the full Advanced Charts widget) for candle pattern detection
- **Backtest charts** at /development/backtest — lightweight chart with RSI/MACD/EMA overlays using the backtest engine
- **Charts Lab** at /lab/charts-lab — dedicated chart experimentation page
- **Snapshot replay** at /lab/snapshot-replay — mini candlestick charts with date-range comparison, source badges (database/MT5)

### Implementation Guidance
- The TradingView **Advanced Charts** widget (free for personal use) is already used in the training area — prefer this over lightweight-charts for consistency
- Price data is available via GET /api/backtest/chart-data and through the existing MT5 bridge
- Custom overlay data (SEES directives) can be fetched from GET /api/scoring/ranked and GET /api/scoring/gated/:symbol
- For directive markers on charts, consider the existing Signal Ladder + Directive Drilldown page as a reference
- The "Custom Overlay" markers described here align with what already exists in the scoring pipeline — no need to build a new overlay system from scratch
