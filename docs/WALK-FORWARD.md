# GitHub Issue: Walk-Forward Optimization & Out-of-Sample Validation

## Why This Gives an Edge
Standard backtesting optimizes parameters on the entire dataset, then reports performance on that SAME dataset. This is curve-fitting — the strategy memorizes the past but fails in the future. Walk-forward optimization prevents this.

## How It Works

1. Split data: 2021-2022 (in-sample) | 2023 (out-of-sample)
2. Optimize strategy parameters using ONLY 2021-2022 data
3. Test optimized parameters on 2023 data (the strategy has never "seen" this)
4. Slide window forward: 2022-2023 (in-sample) | 2024 (out-of-sample)
5. Repeat across multiple windows
6. Aggregate out-of-sample results — THIS is the real expected performance

## What to Implement

### Walk-Forward Engine
- Configurable window sizes (e.g., 2yr in-sample, 1yr out-of-sample)
- Parameter optimization within each in-sample window
- Performance aggregation across all out-of-sample periods

### Parameter Stability Score
- Does the optimal RSI period stay at 14 across all windows, or jump from 7 to 21?
- Unstable parameters = overfitting
- Report: "Parameter stability: 3/10 parameters stable ⚠"

### Out-of-Sample vs In-Sample Comparison
- In-sample: 72% win rate
- Out-of-sample: 54% win rate
- Degradation of 18% = strategy is overfit
- Green flag if <5% degradation

### Walk-Forward Efficiency
- Out-of-sample Sharpe / In-sample Sharpe
- > 0.8 = robust, < 0.5 = overfit

## Integration
- New tab in Backtest page: "Walk-Forward"
- Visual: multiple equity curves overlaid in different colors
- Table: per-window metrics with OOS/IS ratio

## Labels
enhancement, backtest, validation, P0

## Priority
P0 — prevents deploying overfit strategies
