# GitHub Issue: Risk-Adjusted Performance Metrics

## Why This Gives an Edge
A strategy showing 62% win rate could be terrible if winners average +0.3% and losers average -2.1%. Raw win rate is deceptive. Risk-adjusted metrics reveal the truth.

## What to Implement

### Sharpe Ratio
- (Strategy Return - Risk-Free Rate) / Standard Deviation of Returns
- Measures return per unit of risk
- > 1.0 = good, > 2.0 = excellent

### Sortino Ratio
- Like Sharpe but only penalizes downside deviation
- Better for strategies with asymmetric returns
- > 1.5 = good

### Calmar Ratio
- Annual Return / Maximum Drawdown
- Measures how efficiently the strategy recovers from losses

### Maximum Adverse Excursion (MAE)
- Worst unrealized loss per trade before turning profitable
- Shows if stops are too tight or too loose

### Maximum Favorable Excursion (MFE)
- Best unrealized profit per trade before exit
- Shows if take-profits are cutting winners short

### Profit Factor
- Gross Profit / Gross Loss
- > 1.5 = viable, > 2.0 = strong

### Expectancy
- (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
- What you expect to make per trade on average

## Integration
- Display on Strategy Overview page
- Color-coded: green (>target), yellow (borderline), red (<target)
- Recalculate on each new trade

## Labels
enhancement, risk, performance, P0

## Priority
P0 — without these, you can't evaluate if a strategy is actually good
