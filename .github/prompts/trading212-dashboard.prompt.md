# trading212-dashboard: Unified Trading212 Command Center

**Prompt ID:** trading212-dashboard
**Date:** 2026-06-25
**Status:** ready

## Goal

Create a single unified view for Trading212 portfolio management. This is the command center where the user sees everything TCS is doing with their real portfolio — scores, strategies, trade decisions, and history. No more jumping between 5 different pages.

## The Problem

Currently, the user has to visit:
- `/trading/speed-trading` for manual trading
- `/scoring/sees-live-stack` for scores
- `/trading/mt5-trading` for positions
- `/watchlists/user-watchlists` for symbol lists
- `/portfolio` for portfolio data

None of these are connected. The user can't see their portfolio being scored in real-time, can't see why a strategy fired, and can't trust that the automation won't do something unexpected.

## The Solution

A single page: `/trading/trading212-dashboard`

```
┌─────────────────────────────────────────────────────────────┐
│  Trading212 Dashboard                        [Auto: ON ●]   │
│  Portfolio: £1,247.32 ▼2.3% today                          │
├──────────────────────┬──────────────────────────────────────┤
│  Portfolio Scores    │  Active Strategy                     │
│  ┌────────────────┐  │  ┌────────────────────────────────┐  │
│  │ # NVDA  78 ↑   │  │  │ Strategy: momentum-stock-v1    │  │
│  │ # MSTR  72 ↑   │  │  │ Protocol: momentum-stock-v1    │  │
│  │ # PLTR  65 ↑   │  │  │ Auto-Trade: OFF (threshold 75) │  │
│  │   TSLA  55 →   │  │  │ Score interval: 5 min          │  │
│  │   AAPL  48 →   │  │  │ Last run: 14:32:05 (12s)       │  │
│  │   ...          │  │  │ Next run: 14:37:05             │  │
│  └────────────────┘  │  └────────────────────────────────┘  │
│                      │                                      │
│  Why NVDA scored 78 │  Trade History                       │
│  ┌────────────────┐ │  ┌────────────────────────────────┐  │
│  │ speed-momentum  │  │  │ 14:28  BUY  NVDA  @142.30    │  │
│  │   ████████ 92   │  │  │       Score:78  Gate:pass     │  │
│  │ volume-confirm  │  │  │ 14:15  SELL PLTR @22.15      │  │
│  │   ██████   72   │  │  │       Score:25  Gate:block    │  │
│  │ rsi-oversold    │  │  │       Reason: liquidity gate  │  │
│  │   ████████ 88   │  │  │ 13:52  BUY  MSTR @1580.00    │  │
│  │ risk gate: 0.85 │  │  │       Score:82  Gate:boost    │  │
│  │   ████ (pass)   │  │  └────────────────────────────────┘  │
│  └────────────────┘ │                                      │
└──────────────────────┴──────────────────────────────────────┘
```

## Key Features

### 1. Portfolio Score Panel (left)
- Live scoring of Trading212 portfolio symbols
- Ranked by composite score
- Signal class (BUY/SELL/HOLD)
- Updates every N seconds (configurable)
- Click any symbol to see WHY it scored that way

### 2. Directive Breakdown (selectable)
- When a symbol is clicked, show which directives fired
- Bar chart showing each directive's contribution
- Risk gate status: passed/blocked/boosted
- Time since last evaluation

### 3. Strategy Panel (top-right)
- Currently active protocol and strategy
- Auto-trade toggle (master switch)
- Score threshold for trade execution
- Interval setting
- Last/next run timestamps

### 4. Trade History (bottom-right)
- Every trade decision recorded
- Buys, sells, rejects with reasons
- Links back to the score that triggered it
- P&L tracking per trade

### 5. Connection Status
- Trading212 API health
- MT5 bridge status
- Last successful data sync

## Technical Architecture

### Frontend
- New page: `src/pages/Trading212DashboardPage.jsx`
- Polls backend every N seconds for live scores
- Uses `@tanstack/react-query` for data fetching
- WebSocket optional (polling is simpler for v1)

### Backend Integration
- `GET /api/portfolio/trading212` — portfolio positions
- `POST /api/scoring/gated/batch` — batch score symbols
- `GET /api/trading/trade-history?provider=trading212` — trade log
- `POST /api/automation/status` — automation state
- `POST /api/automation/toggle` — enable/disable auto-trade

### Automation State Endpoint
```
GET /api/automation/status
{
  enabled: boolean,
  activeProtocol: string,
  activeStrategy: string,
  scoreIntervalMs: number,
  tradeThreshold: number,
  lastRunAt: string,
  nextRunAt: string,
  lastRunMs: number,
  pendingActions: number
}
```

## Design Principle

This page is the **single source of truth** for Trading212. Everything the app does with Trading212 is visible here. The user can see, understand, and override any automated decision before it executes.

## Files
- `src/pages/Trading212DashboardPage.jsx`
- `src/pages/Trading212DashboardPage.css`
- Route in `App.jsx`: `/trading/trading212-dashboard`
