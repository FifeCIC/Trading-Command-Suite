# Handoff: Backtest UI Unification Plan (#467)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-29
**Issue:** #467 — Discussion: Unify trading and backtesting UI with shared components

## Decision

**Charts deferred to Phase 5. Non-chart unification starts Phase 2.** The backtest backend already has 14 endpoints — the frontend just needs to expose them without charts slowing things down.

### Backend Audit (already built)

| Endpoint | Purpose | Frontend UI? |
|----------|---------|-------------|
| `POST /run` | Run backtest | ✅ exists (with charts) |
| `POST /optimize` | Grid search SL×TP | ❌ |
| `POST /walk-forward` | Train/test split validation | ❌ |
| `POST /runs/compare` | Side-by-side run comparison | ❌ |
| `POST /coverage` | Per-directive performance | ❌ |
| `GET /benchmark` | Buy-and-hold comparison | ❌ (built #52, no UI) |
| `GET /equity/:runId` | Equity curve + drawdown | ❌ |
| `GET /data-inventory` | Bar counts, date ranges | ✅ BacktestDataPage |
| `GET /runs` | List all runs | ❌ |
| `GET /chart-data` | Chart-ready OHLCV | ✅ (deferred) |

### Phase Plan

| Phase | Focus | Key deliverables |
|-------|-------|-----------------|
| **2** | Core (no charts) | Results table, config save/load, parameter sweep UI, walk-forward UI, CSV export, benchmark card |
| **3** | Analytics | A/B comparison, batch runs, coverage viz, performance tracking |
| **5** | Charts | TradingView embedding, shared TradingChart, trade markers, equity curve viz |

### Shared components (cross-cut)
- `ExecutionRealismPanel` — slippage/spread/commission/sizing. Same for backtest + live trading.
- `ResultsTable` — sortable PnL/win rate/max DD/Sharpe/trades columns
- `SignalCard` — composite score + directive breakdown. Same format for backtest results + live signals.

### Files for reference

| File | What it has |
|------|-------------|
| `nest/src/modules/backtest/backtest.controller.ts` | 14 endpoints — mature backend |
| `nest/src/modules/backtest/backtest.service.ts` | Backtest engine logic |
| `src/pages/BacktestPage.jsx` | Current UI with charts, execution panel, presets |
| `src/pages/BacktestDataPage.jsx` | Data inventory + MT5 recording status |
| `src/components/backtest/` | BacktestChartPane, EquityCurveChart (deferred to P5) |
