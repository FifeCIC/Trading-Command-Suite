# Risk Controls — How It Works

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-07-02
**Last updated:** 2026-07-02
**Owner:** TCS team


## Overview

The Risk Controls system provides central guardrails for trading: exposure caps, drawdown limits, a three-gate pre-trade check pipeline, and a circuit breaker that can halt all trading.

## Architecture

Three subsystems work together:

```
RiskService          — Stop loss, take profit, position sizing, drawdown monitoring
TradingGatesService   — 3-gate pipeline (threshold, scope, position checks)
RiskGatingEngine      — Tiered multiplicative risk gating in scoring pipeline
    ↓
RiskController        — Unified dashboard endpoint: GET /api/risk/overview
    ↓
RiskControlsPage      — Gauges, health cards, gate config, circuit breaker UI
```

## Key Components

### RiskService (`nest/src/modules/risk/risk.service.ts`)

| Feature | Methods |
|---------|---------|
| Stop Loss | `calculateStopLoss()` — fixed-pct, ATR-multiple, swing-low, time-based |
| Take Profit | `calculateTakeProfit()` — fixed-pct, risk-reward, multi-target, trailing-ATR |
| Position Sizing | `calculatePositionSize()` — fixed, risk-based, Kelly (half-Kelly safety) |
| Drawdown | `checkDrawdown()` — peak-to-current, alerts at 12% (warn) and 25% (critical) |
| Position Limits | `canOpenPosition()` — max positions, max per-symbol allocation |

### TradingGatesService (`nest/src/modules/trading-gates/trading-gates.service.ts`)

Three gates every trade must pass:

| Gate | Checks |
|------|--------|
| **Threshold** | minScore (60), minConfidence (0.6), minNormalizedScore (0.6), long/short thresholds |
| **Scope** | Whitelist/blacklist, market types, min price ($5), min avg volume (1M), trading hours (9:30-16:00 ET) |
| **Position** | Max positions (5), cooldown hours (48), min holding bars (3), averaging permission, opposite signal close |

### RiskGatingEngine (`nest/src/modules/scoring/risk-gating-engine.service.ts`)

Tiered multiplicative gating applied during scoring:

| Tier | Effect |
|------|--------|
| **hard_gate** | Veto — blocks the trade entirely (budget-gate, position-concentration, liquidity-check) |
| **soft_modifier** | Proportional scaling (correlation-drag, dilution-impact, volatility-regime, rollover-risk) |
| **regime_override** | Directional bias adjustment (dxy-regime) |

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/risk/overview` | Unified dashboard: portfolio health + limits + 3-gate config + circuit breaker |
| `GET /api/risk/portfolio-health` | Position P&L, trade P&L, drawdown from cumulative P&L curve, risk warnings |
| `GET /api/risk/limits` | Risk profile config (max portfolio risk, per-trade, per-symbol, drawdown) |
| `POST /api/risk/calculate-position` | Position sizing calculator (SL, TP, shares, capital required) |

### Circuit Breaker

The circuit breaker evaluates three triggers:
- Drawdown > 20% → TRIPPED
- Exceeded max drawdown config → TRIPPED
- Total exposure > 80% → TRIPPED

When tripped, all automated trading should halt. Auto-reset after 60 minutes (configurable).

## Portfolio Health

Portfolio health queries real data:
- **Position count**: From Prisma `Position` table
- **Position P&L**: Aggregate `pnl` field across all positions
- **Trade P&L**: Last 50 closed trades from `Trade` table
- **Daily P&L**: Today's closed trades
- **Drawdown**: Computed from cumulative P&L curve of trade history
- **Risk warnings**: Drawdown thresholds, empty portfolio, daily P&L drops

## UI Features

- **Gauge panel**: Drawdown (conic gradient ring, green/yellow/red), Exposure, Daily P&L
- **Circuit Breaker**: Pulsing red border when TRIPPED, green when READY
- **Portfolio Health cards**: Position count, P&L, trade P&L, max drawdown
- **Risk Limits grid**: 6 configured limits
- **Trading Gates**: 3-column cards showing active config for each gate
- **Kill Switch Log**: Circuit breaker event history

