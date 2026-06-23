---
description: "Replace hardcoded 5-directive backtest scoring with the full 77-directive SEES pipeline and add parameter optimization. Use when: running backtests, optimizing directive weights, or implementing walk-forward analysis."
argument-hint: "All directives or specific subset? Optimize weights?"
---

# Backtest — Use All Directives + Parameter Optimization

## Problem
`BacktestService` uses a hardcoded `STRATEGY_WEIGHTS` constant with only 5 directives:
```typescript
const STRATEGY_WEIGHTS = {
  'rsi-oversold': 24,
  'macd-crossover': 22,
  'ema-structure': 20,
  'atr-dip': 18,
  'volume-confirmation': 16,
};
```
All 77 registered directives — doji patterns, engulfing, ADX, Bollinger, VIX regime, session timing, earnings proximity, analyst adjustments — are ignored. The production scoring pipeline (`ScoringService.rankAll()`) already runs all directives, but the backtest bypasses it.

## Solution
Replace the hardcoded 5-directive approach with the full `ScoringService.rankAll()` production pipeline and add parameter optimization.

## Implementation

### 1. Use Production Scoring Pipeline
Replace the sliding-window loop's scoring block:
```typescript
// OLD: Hardcoded 5-directive scoring
const results = this.directivesService.runAll(input);
let score = 0;
for (const [id, result] of results) {
  score += (result.score * (STRATEGY_WEIGHTS[id] || 0)) / 100;
}

// NEW: Use full production pipeline
const ranked = await this.scoringService.rankAll(strategyId, 1);
const symbolResult = ranked.ranked.find(r => r.ticker === symbol);
const score = symbolResult?.normalizedScore ?? 0;
```

### 2. Configurable Directive Selection
```typescript
POST /api/backtest/run
body: {
  symbol: "NVDA",
  days: 365,
  directiveIds?: string[];  // ["rsi-oversold", "macd-crossover", "engulfing-pattern"]
  weights?: Record<string, number>;  // { "rsi-oversold": 30, ... }
}
```

### 3. Grid Search Optimization
```typescript
POST /api/backtest/optimize
body: {
  symbol: "NVDA",
  days: 365,
  paramRanges: {
    "rsi-oversold": { min: 10, max: 40, step: 5 },
    "macd-crossover": { min: 10, max: 40, step: 5 },
  },
  target: "sharpe" | "winRate" | "profitFactor"
}
```
- Runs backtest for every combination of parameter values
- Returns top N combinations sorted by target metric

### 4. Walk-Forward Analysis
```typescript
POST /api/backtest/walk-forward
body: {
  symbol: "NVDA",
  trainDays: 730,    // Optimize weights on first 2 years
  testDays: 365,     // Test on following 1 year
  stepDays: 90,      // Slide forward 90 days and repeat
  totalDays: 1825,   // 5 years total
}
```
- For each walk-forward step: optimize weights on train window → measure performance on test window
- Returns: out-of-sample performance metrics (not in-sample)

### 5. Acceptance
- [ ] Backtest uses ScoringService.rankAll() instead of hardcoded weights
- [ ] Configurable directive selection works
- [ ] Grid search returns optimized weight combinations
- [ ] Walk-forward produces out-of-sample metrics
- [ ] Results persist to BacktestRun table (via #45)

## Related Issues
- [#48](https://github.com/FifeCIC/trading-command-suite/issues/48) — this prompt's implementation
- [#45](https://github.com/FifeCIC/trading-command-suite/issues/45) — Result Persistence (needed for optimization runs)
- [#46](https://github.com/FifeCIC/trading-command-suite/issues/46) — Equity Curve + Portfolio
- Protocol Risk Gating (already implemented) — could apply multiplicative gating to backtest scoring
