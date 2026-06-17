---
description: "Initialize a trading session — loads portfolio, runs SEES scores, checks provider health, and cross-references holdings with upcoming earnings. Use when: starting a trading session, checking daily readiness, or getting a full portfolio overview in one command."
argument-hint: "Session type (quick, full, pre-market)?"
---
Initialize a trading session by loading all relevant data in one shot. This avoids the repetitive exploration pattern we suffered through in the first session.

## What to Load (parallel where possible)

### 1. Provider Health Check
```bash
curl -s http://localhost:3201/api/providers/health
```
- Which providers are online?
- Any degraded or rate-limited?

### 2. Portfolio Snapshot + Scores
```bash
curl -s http://localhost:3201/api/portfolio/summary
curl -s http://localhost:3201/api/portfolio/scores
```
- Position count, total value, P&L
- SEES scores per holding (buy/hold/sell signals)

### 3. Portfolio Earnings Cross-Reference
```bash
curl -s "http://localhost:3201/api/portfolio/events?days=90"
```
- All upcoming earnings for holdings
- Days until each event
- EPS estimates
- Flag any within 7 days (pre-earnings risk zone)

### 4. Recent Trade History
```bash
curl -s "http://localhost:3201/api/portfolio/trading212/history?days=30"
```
- Recent buys/sells
- Win rate and P&L summary

### 5. MT5 Account Status
```bash
curl -s http://localhost:3201/api/providers/mt5/accounts
```
- Account balances
- Connection status

## Session Output Format
```
## 🟢 Trading Session — [DATE] [TIME]

### Portfolio: $X,XXX | P&L: ±$XXX (X.X%) | X positions
### Providers: Alpaca 🟢 | Alpha Vantage 🟢 | Trading212 🟢 | MT5 ⚫

### 📅 Upcoming Earnings
| Ticker | Date | Days | EPS Est | Position Value |
|--------|------|------|---------|----------------|
| MSTR | Jul 30 | 43 | $52.04 | $162 |
| NVDA | Aug 26 | 69 | $2.09 | $814 |

### 🎯 SEES Signals
| Ticker | Score | Signal | Strength |
|--------|-------|--------|----------|
... 

### ⚠️ Alerts
- MSTR earnings in 43 days (EPS $52.04 — massive estimate)
- X positions have no earnings data
```

## Storage
Save session snapshot to localStorage key `tcs:session-{date}` for comparison across sessions.

## Implementation Notes
- All API calls are GET requests — can be parallelized
- Portfolio import (POST /import) only needed if data is stale (>1 hour)
- Cache earnings data in DB (see `store-earnings-calendar` prompt) so this step is instant
- The `trading-agent` skill already has the API reference — use it
