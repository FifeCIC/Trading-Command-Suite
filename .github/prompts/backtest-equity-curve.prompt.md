---
description: "Add cumulative equity curve, drawdown visualization, and portfolio-level backtesting to the backtest chart. Use when: building backtest visualizations, adding equity curves, or enabling multi-symbol portfolio backtests."
argument-hint: "Single symbol or portfolio mode?"
---

# Backtest Equity Curve + Portfolio-Level Backtesting

## Problem
The backtest chart (`BacktestChart.jsx` + `BacktestChartPane.jsx`) shows entry signals on a price chart but has no equity curve — the single most important visualization in professional backtesting. You cannot see cumulative P&L over time, drawdown periods, or recovery patterns. Additionally, backtests are single-symbol only.

## Solution
Add an equity curve pane and portfolio-level backtesting.

## Implementation

### 1. Equity Curve Data
Modify `BacktestService` to compute an equity curve array during the sliding-window pass:
```typescript
interface EquityPoint {
  date: string;
  equity: number;       // Cumulative P&L
  drawdown: number;     // % drawdown from peak
  signal: boolean;      // Was there an entry on this bar?
}
```

### 2. Equity Curve Chart
Add a new pane to `BacktestChart.jsx` below the price chart:
- **AreaSeries** for equity curve (green above initial, red below)
- **Drawdown shading** — semi-transparent red overlay during drawdown periods
- **Stats overlay** — max drawdown %, max drawdown duration, CAGR, Calmar ratio
- Sync crosshair with price chart

### 3. Portfolio Backtest
New endpoint: `POST /api/backtest/run-portfolio`
```typescript
body: {
  symbols: string[];        // ["NVDA", "MSTR", "RBLX"]
  weights?: number[];       // [0.4, 0.3, 0.3] — allocation weights
  days: number;
  timeframe: string;
}
```
- Runs individual backtest for each symbol
- Aggregates equity curves weighted by allocation
- Computes portfolio-level stats: total return, Sharpe, max drawdown, correlation matrix

### 4. UI Changes
- Portfolio mode toggle in BacktestPage
- Multi-symbol input (comma-separated or tag input)
- Allocation weight sliders
- Correlation heatmap between portfolio symbols

### 5. Acceptance
- [ ] Equity curve renders on chart with drawdown shading
- [ ] Equity curve stats (max DD, CAGR, Calmar) computed correctly
- [ ] Portfolio backtest aggregates multiple symbols
- [ ] Correlation matrix computed for portfolio symbols

## Related Issues
- [#46](https://github.com/FifeCIC/trading-command-suite/issues/46) — this prompt's implementation
- [#45](https://github.com/FifeCIC/trading-command-suite/issues/45) — Result Persistence (portfolio runs need DB)
- [#48](https://github.com/FifeCIC/trading-command-suite/issues/48) — All Directives (portfolio needs accurate per-symbol scoring)
