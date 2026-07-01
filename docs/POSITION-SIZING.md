# GitHub Issue: Position Sizing & Capital Allocation Methods

## Why This Gives an Edge
Trading the same $100 on every signal ignores conviction. A 92% confidence signal deserves more capital than a 62% one. Proper position sizing is the difference between +15% and +35% annual returns from the same signals.

## Methods to Implement

### Fixed Fractional
- Risk X% of account per trade (e.g., 2%)
- Position size = (Account × Risk%) / Stop Distance
- Simple, reliable, most common

### Kelly Criterion
- Kelly % = WinRate - (LossRate / WinLossRatio)
- Optimal for maximum growth, aggressive
- Half-Kelly recommended (less volatile)
- Danger: Full Kelly can produce 80% drawdowns

### Volatility-Adjusted
- Position size inversely proportional to ATR
- Smaller positions in volatile conditions
- Larger positions in calm conditions
- More consistent risk per trade

### Confidence-Weighted
- Position size scales with scoring conviction
- Conviction 92% → 100% of base size
- Conviction 65% → 50% of base size
- Conviction < 50% → no trade

### Equal Risk Per Trade
- Every trade risks exactly the same dollar amount
- Stop distance determines position size
- Most consistent risk exposure

## Integration
- Position sizing method selectable per trading strategy
- Visual comparison: equity curves from different sizing methods
- Warning if Kelly suggests >25% allocation

## Labels
enhancement, risk, trading, P0

## Priority
P0 — same signals, different sizing = dramatically different returns
