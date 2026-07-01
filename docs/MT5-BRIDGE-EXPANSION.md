# GitHub Issue: MT5 Bridge — Full Feature Control

## Current State
Bridge at localhost:5000 has: health, quote, candles, symbols, account, positions, order, close, history, reconnect, refresh, accounts, switch.

## What's Needed

### Multi-Account Support
- Users can connect their own MT5 terminal + accounts
- Simultaneous demo + live account connection (or quick switch)
- Account selector in app header
- Per-account P&L isolation
- "Your account credentials never leave your machine" — bridge runs locally

### Missing Trading Endpoints
- POST /order/modify — modify SL/TP of existing order
- POST /order/pending — place limit/stop pending orders
- POST /close/partial/<ticket> — partial position closure
- GET /symbol/<name>/info — contract size, margin rate, swap rates, tick size, tick value
- GET /ticks/<symbol> — SSE streaming of tick data

### Missing Platform Features
- GET /calendar — economic calendar from MT5
- GET /account/history/deals — deal history with filtering
- GET /account/orders/history — historical orders
- POST /account/test — test connection to new account before switching
- GET /terminal/info — MT5 terminal version, build, connected status

### Interface Requirements
- MT5 Connection Manager page at /settings/mt5
  - Account list: name, server, demo/live badge, balance, connection status
  - Add Account form: account number, password, server, label
  - Test Connection button
  - Set Active account
  - Connection logs
- Account badge in app header: "MT5 Demo: $1,000 | MT5 Live: —"
- Quick-switch dropdown

### Discussion Needed
- Should bridge support WebSocket for real-time streaming or stay polling?
- Multi-tenant: one bridge instance serves multiple browser clients?
- Authentication between browser ↔ bridge?

Labels: infrastructure, mt5, P0
