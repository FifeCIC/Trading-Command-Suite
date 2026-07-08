# Execution Features — Sprint 2026-07-04

Four features that make trade execution more realistic and adaptive.

---

## 1. Slippage & Spread Modeling (Backtest)

Backtests now model real execution costs instead of assuming perfect fills.

### How It Works

```
POST /api/backtest/run
{
  "symbol": "XAUUSD",
  "days": 365,
  "slippage": 0.0001,
  "spread": 0.0001,
  "newsExclusion": "none"
}
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `newsExclusion` | `"none"` | `"none"` — include all signals; `"exclude"` — skip news days (protocol purity); `"only"` — only news days (sensitivity); `"reduce"` — planned: weight signals lower on news days |

| Asset Class | Default Slippage | Default Spread | Auto-Detection |
|-------------|-----------------|----------------|----------------|
| **Forex** (6-char symbol) | 0.0001 (1 pip) | 0.0001 (1 pip) | Auto via `isForex` check |
| **Stocks/Other** | 0.01 (1%) | 0.01 (1%) | Default fallback |

### Cost Application

- **Entry:** `actualEntry = signalPrice + spread/2` (you pay the ask)
- **Exit:** `actualExit = exitPrice - slippage` (market order slippage on close)

### Impact

Enabling slippage/spread modeling will **reduce** backtest win rates and average P&L — this is correct. Real trading has costs. Use this to:
- Validate that a strategy's edge survives execution costs
- Compare strategies on risk-adjusted, cost-inclusive returns
- Set realistic expectations before going live

### Related Endpoints

```
GET /api/backtest/equity/:runId     — Cumulative P&L equity curve + drawdown (#103)
POST /api/backtest/coverage         — Per-directive win rate across all 99 directives (#106)
```

---

## 2. Regime-Adaptive Position Sizing

Position sizes automatically scale based on market conditions detected by `ConditionDetectorService`.

### How It Works

When a trading strategy executes, the current market regime is checked:

| Regime | Size Multiplier | Rationale |
|--------|----------------|-----------|
| **High Volatility** | 0.5× | Half-size — volatility means wider swings, same risk |
| **Chaotic** | 0.25× | Quarter-size — market is unpredictable, preserve capital |
| **Strong Trend** (>0.7 strength) | 1.25× | 25% boost — trend is your friend, capitalize |
| **Normal** | 1.0× | Standard sizing |

### Example

A strategy with `baseSize: 0.10` lots:
- Normal day → 0.10 lots
- High vol day → 0.05 lots (half)
- Chaotic day → 0.025 lots (quarter)
- Strong trend → 0.125 lots (boosted)

The regime label and multiplier are included in the execution notification so you know why your size changed.

---

## 3. Trailing Stops (Design Spec — Partial Implementation)

### What's Implemented

The trail parameters are **computed** on every strategy execution:

```
trailDistance = slPct × 0.75      (stop trails 75% of SL distance behind price)
activation    = slPct × 1.5       (trailing activates once profit reaches 1.5× SL)
```

For a strategy with `slPct = 1.0` (1% stop-loss):
- Trail distance: 0.75% behind current price
- Activation: kicks in at 1.5% profit

The `riskService.updateTrailingStop()` pure function exists and correctly computes new stop levels.

### What's NOT Yet Implemented

A monitoring loop that:
1. Polls open MT5 positions every 30–60 seconds
2. Checks if profit exceeds activation threshold
3. Calls MT5 bridge to modify the SL to the trailing level
4. Only moves the stop in the profitable direction (never widens)

This needs to be built — likely as part of the automation loop or a new `TrailingStopService`.

### Current Behavior

- Fixed SL is placed at order entry (if specified)
- Trailing stop parameters appear in execution notifications as informational
- No automatic stop adjustment occurs post-entry

---

## 4. MT5 Candle Fallback

### Problem
Scoring requires market data bars. If a symbol hasn't been imported yet (no bars in the `marketbar` table), scoring fails silently.

### Solution
When the scoring pipeline or strategy evaluator finds fewer than 30 bars for a symbol:

1. Queries the `marketbar` table → gets whatever bars exist
2. If < 30 bars → calls the MT5 bridge directly: `GET {bridge}/candles?symbol=X&timeframe=1h&limit=200`
3. Imports MT5 bars into the database: `prisma.marketBar.createMany({ skipDuplicates: true })`
4. Uses the combined DB + MT5 bar set for scoring

### Trigger Points

| Service | When It Triggers | Timeframe |
|---------|-----------------|-----------|
| `ScoringService` (scoring pipeline) | < 30 bars for a symbol in scoring batch | 1h (hardcoded) |
| `TradingStrategyService.evaluate()` | < 30 bars for the strategy's symbol | Strategy's configured timeframe |
| `SnapshotsModule` (snapshot import) | 0 bars in requested date range | User-specified |

### What This Means

- **No more manual bar imports needed.** If MT5 has the data, TCS will fetch it on-demand.
- **First-time symbol scoring is slower** (2–5 seconds for the bridge call + import) but subsequent runs use cached DB bars.
- **Provider is tracked:** Imported bars are tagged `provider: 'mt5'` in the database.
