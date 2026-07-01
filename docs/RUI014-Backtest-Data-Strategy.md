# RUI014 — Backtest Data: Symbol Unification & Priority Expansion

**Agent:** tcs-dev
**Area:** Data / Backtesting
**Priority:** P2 — data quality
**Depends on:** BacktestDataPage.jsx (updated), MT5 bridge, Trading212 adapter

## Recent Changes (Done)

- Priority symbols grouped at top with ★ indicator
- MT5 column added (forex/indices/commodities/crypto = MT5, stocks = —)
- REC column tooltips improved
- BT RUNS explanation added

## Task

### Phase 1: BTC-USD vs BTCUSD Resolution
- Two Bitcoin tickers exist — determine if they have different data sources
- `BTC-USD` likely from crypto exchange, `BTCUSD` from MT5/forex broker
- Recommend: consolidate to one canonical ticker with provider-tagged data, or clearly differentiate

### Phase 2: Priority Symbol Expansion
Current priority: SPY, SPX500, UK100, US30, USDJPY, XAUUSD, USOIL, VIX, BTC-USD, BTCUSD, QQQ, TECH100, DOGEUSD, COIN

Add user-suggested symbols for short-term profit taking:
- **EURUSD** — most liquid forex, tight spreads
- **GBPUSD** — volatile London/NY overlap
- **XAGUSD** (Silver) — more volatile than gold
- **GER40 / DAX** — European index
- **TSLA** — high IV options
- **NVDA** — AI sector leader

### Phase 3: Download & Test
- Download historical data for priority symbols (at least 1 year)
- Run initial backtests on priority set
- Verify MT5 recording works for all MT5-recordable priority symbols
