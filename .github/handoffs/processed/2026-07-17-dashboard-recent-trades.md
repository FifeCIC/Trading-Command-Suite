---
date: 2026-07-17
area: ui
type: feature
---

## What Changed

Completed #324 — Dashboard page structure. All acceptance criteria were already met from prior sessions (portfolio summary, P&L breakdown, market sessions, dev updates, news card, hot picks, nav grids). Added the one missing piece: Recent Trade Activity section.

## Files Changed

- `src/pages/DashboardPage.jsx` — added history query (GET /api/providers/mt5/history) + Recent Trades table with last 5 trades
- `src/pages/HomeDashboard.css` — added .dash-buy, .dash-sell, .dash-time styles

## Capability Map Entry

- **name:** Dashboard Recent Trades
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Dashboard
- **name:** Recent trades table shows last 5 completed trades
- **procedure:** With MT5 connected, navigate to /dashboard. Scroll to "Recent Trades" section below positions. Verify last 5 trades show with symbol, type, volume, price, P&L, and time.
- **expected:** Recent trades table visible when MT5 connected. Buy rows green, sell rows red. P&L colored accordingly.

## Architecture Framework Entry

- **section:** trading
- **summary:** Dashboard Recent Trades — queries /api/providers/mt5/history?limit=5, renders last 5 completed trades below open positions table. Each row shows symbol, type (BUY/SELL with green/red), volume, price, P&L, and timestamp. Only visible when MT5 bridge is connected. Files: DashboardPage.jsx, HomeDashboard.css.
