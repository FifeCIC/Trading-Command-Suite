---
description: "Persist backtest results to database and build run comparison — currently results are in-memory only and lost on restart. Use when: running backtests, comparing strategies, or building the backtest dashboard."
argument-hint: "Which symbol and timeframe?"
---

# Backtest Result Persistence + Run Comparison

## Problem
`BacktestService` stores results in an in-memory `Map<string, BacktestResult>`. Every server restart wipes all history. There is no way to compare two runs side-by-side, track improvement over time, or export results.

## Solution
Persist runs to `BacktestRun` table and build comparison endpoints.

## Implementation

### 1. Prisma Model
```prisma
model BacktestRun {
  id            String   @id @default(uuid()) @db.VarChar(36)
  symbol        String   @db.VarChar(20)
  timeframe     String   @db.VarChar(10)
  days          Int
  strategy      String?  @db.VarChar(50)
  totalSignals  Int
  winRate       Float
  avgReturn     Float
  maxDrawdown   Float
  profitFactor  Float
  sharpe        Float
  signals       Json
  summary       Json
  createdAt     DateTime @default(now())

  @@index([symbol, createdAt])
}
```

### 2. Service Changes
- `POST /run` — write result to DB, return `{ runId, ...stats }`
- `GET /runs?symbol=NVDA` — list all runs for symbol, ordered by date
- `GET /runs/:id` — single run with full signals array
- `GET /compare?ids=1,2,3` — side-by-side stats for multiple runs
- `DELETE /runs/:id` — delete a run
- `GET /runs/:id/export?format=csv` — downloadable CSV

### 3. UI Changes (BacktestPage.jsx)
- Run history sidebar — list of past runs with date, symbol, win rate
- Click to load a run's full results
- Checkbox to select up to 3 runs for comparison
- Comparison table showing all stats side-by-side
- Download CSV button

### 4. Acceptance
- [ ] Backtest runs persist across server restarts
- [ ] Can list all runs for a symbol
- [ ] Can compare up to 3 runs side-by-side
- [ ] CSV export works

## Related Issues
- [#45](https://github.com/FifeCIC/trading-command-suite/issues/45) — this prompt's implementation
- [#46](https://github.com/FifeCIC/trading-command-suite/issues/46) — Equity Curve (uses persisted runs)
- [#48](https://github.com/FifeCIC/trading-command-suite/issues/48) — All Directives (uses persisted runs for comparison)
