---
description: "Audit the backtesting system for Bitcoin speed trading support: bracket order simulation, high-quality chart rendering, fast multi-month backtests, and BTC historical data acquisition. Use when: preparing to backtest the BTC Speed Protocol, evaluating backtest infrastructure, or importing historical crypto data."
argument-hint: "BTC only or multi-symbol? Focus on chart or speed?"
appliesTo: "nest/src/modules/backtest/**, src/pages/BacktestPage.jsx, src/components/backtest/**"
---

# Backtest Review — Bitcoin Speed Trading Readiness

## Problem

The BTC Speed Protocol needs rigorous backtesting before live trading. The current backtest system must support:

1. **Bracket order simulation** — equal-distance SL/TP, check which hits first per bar
2. **High-quality chart rendering** — TradingView-quality visualization for user analysis
3. **Fast multi-month simulation** — the app should crunch 2+ years of 5m data quickly
4. **BTC historical data** — at least 4 years of 5m/15m/1h data (one full halving cycle)
5. **Walk-forward optimization** — train on period A, test on period B

## Audit Checklist

### A. Bracket Order Simulation

Does `BacktestService` support:
- [ ] Entry at bar close (not bar open) — realistic for speed trading
- [ ] Simultaneous SL and TP at equal distances
- [ ] Intra-bar SL/TP checking (did the bar's high/low hit SL or TP before close?)
- [ ] Spread/slippage modeling (especially important for crypto on weekends)
- [ ] Commission modeling (exchange fees eat into high-frequency P&L)
- [ ] Partial fills (if position size exceeds bar volume)

**Implementation approach:** Each backtest bar must check, in order:
```
1. Did the bar's low ≤ SL price?  → SL hit, take loss
2. Did the bar's high ≥ TP price? → TP hit, take profit
3. If neither → position continues to next bar
4. If both hit → which was reached first? (use bar's OHLC sequence)
```

### B. Chart Quality

Current backtest chart (`BacktestChart.jsx`) — evaluate:
- [ ] Does it show entries AND exits (not just entry signals)?
- [ ] Is there an equity curve below the price chart?
- [ ] Can the user hover to see trade details (entry price, exit price, P&L)?
- [ ] Is there a trade list/table alongside the chart?
- [ ] Does it support the `lightweight-charts` library fully (vs basic canvas)?
- [ ] Are timeframes clearly labeled (5m bars vs 1h bars)?
- [ ] Is there a performance summary (win rate, avg win, avg loss, profit factor, Sharpe)?

**Reference:** The `backtest-equity-curve.prompt.md` covers equity curve visualization. Ensure that prompt's implementation is complete before evaluating this one.

### C. Fast Multi-Month Simulation

The backtest must run fast enough to be practical:
- **Target:** 2 years of 5m BTC data (~210,000 bars) in under 30 seconds
- **Current bottleneck:** Directive scoring per bar — running 10+ directives per bar × 210K bars = 2.1M directive evaluations

**Optimization approaches:**
1. **Vectorized scoring:** Cache directive results — if price hasn't changed significantly, reuse the last score
2. **Skip scoring on unchanged bars:** Only re-score when a new candle closes
3. **Worker threads:** Split backtest into chunks (year 1, year 2) and parallelize
4. **Pre-computed indicator cache:** Compute RSI, MACD, Bollinger once, share across directives
5. **Score-only mode:** Skip directive breakdown and just compute raw composite (faster, less detail)

### D. BTC Historical Data Acquisition

Need 4+ years of BTC data at multiple timeframes:
- **Source:** MT5 bridge (already working) — can pull BTCUSD from MetaQuotes-Demo
- **Fallback:** Yahoo Finance (free, no key) — `BTC-USD` ticker
- **Resolution needed:** 5m, 15m, 1h, 1d
- **Date range:** At minimum 2022-01-01 to present (covers the 2024 halving and aftermath)

**Implementation:**
```typescript
POST /api/imports/refresh/{btcSymbolId}?timeframe=5m&limit=210000  // ~2 years of 5m bars
POST /api/imports/refresh/{btcSymbolId}?timeframe=1h&limit=35000   // ~4 years of 1h bars
POST /api/imports/refresh/{btcSymbolId}?timeframe=1d&limit=1500    // ~4 years of daily
```

### E. Walk-Forward Optimization

Required for honest protocol validation:
```
Period 1 (2022-2023): Optimize directive weights via grid search
Period 2 (2024):      Walk-forward test (out-of-sample)
Period 3 (2025):      Walk-forward test (out-of-sample)
Period 4 (2026 H1):   Final validation (current year)
```

Each period should report: total return, Sharpe, max drawdown, win rate, profit factor.

If Period 2-4 metrics are similar to Period 1 → protocol is robust, not overfit.

## Deliverables

1. **Audit report** — which of the above capabilities exist vs. need building
2. **Gap implementation** — build what's missing, prioritize bracket order simulation and BTC data
3. **Test run** — run a 2-year BTC backtest with bracket orders, report metrics
4. **Walk-forward results** — if bracket orders work, run the 4-period walk-forward

## References
- Existing backtest prompts: `backtest-all-directives.prompt.md`, `backtest-equity-curve.prompt.md`, `backtest-persistence.prompt.md`
- BTC Theory: `docs/BTC-SPEED-PROTOCOL-THEORY.md`
- BTC Protocol implementation: `btc-speed-protocol-implementation.prompt.md`
- MT5 bridge: `scripts/mt5-bridge/mt5_bridge_v2.py`
