# Paper Trading Guide

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-07-06
**Last updated:** 2026-07-06
**Owner:** TCS team


Virtual trading account with realistic order flow, P&L tracking, and SL/TP enforcement. Use it to test strategies risk-free before going live on MT5.

---

## Account Setup

**Starting balance:** $10,000 (configurable)

The account resets on NestJS restart. To persist across restarts, the `Trade` history table stores all closed trades — the account can be reconstructed.

### Reset Account

```
POST /api/paper-trading/reset
{ "startingBalance": 5000 }
```

Balance is optional — defaults to $10,000. This clears all open positions and resets stats.

---

## API Reference

### Check Account Status

```
GET /api/paper-trading/account
```

Returns:
```json
{
  "balance": 10000,
  "equity": 10234.50,
  "realizedPnl": 180.25,
  "unrealizedPnl": 54.25,
  "drawdownPct": 0.8,
  "maxDrawdownPct": 2.1,
  "winRate": 62.5,
  "totalTrades": 24,
  "openPositions": 2
}
```

### Place an Order

```
POST /api/paper-trading/order
{
  "symbol": "EURUSD",
  "type": "BUY",
  "volume": 0.01,
  "sl": 1.0500,
  "tp": 1.0600,
  "comment": "Testing MTF Conservative breakout"
}
```

- `type`: `"BUY"` or `"SELL"`
- `sl`/`tp`: Optional. If omitted, no stop/take-profit is set.
- Returns a simulated ticket number (starts at 100000).

**Requires a quote to be available.** Before placing orders, quotes must be fed via the mark-to-market pipeline (the automation loop does this automatically when running).

### View Positions

```
GET /api/paper-trading/positions
GET /api/paper-trading/positions/100001
```

### Close Positions

```
DELETE /api/paper-trading/positions/100001          # Close one
POST   /api/paper-trading/close-all                  # Close all
POST   /api/paper-trading/close-profitable           # Close winners only
```

### Modify SL/TP

```
POST /api/paper-trading/modify/100001
{ "sl": 1.0520, "tp": 1.0580 }
```

### Mark to Market

```
POST /api/paper-trading/mark-to-market
```

Updates all positions to current quotes. Auto-closes any that hit SL/TP levels. The automation loop calls this on each tick.

### Trade History

```
GET /api/paper-trading/history
```

Returns last 50 trades from the `Trade` table (provider='paper').

---

## Quote Feed

Paper trading needs live quotes to function. Quotes are fed through `paperTradingService.updateQuote(symbol, price)`:

- **Automation loop:** Calls `updateQuote()` on each tick for watchlist symbols (when running)
- **Manual:** You can call the mark-to-market endpoint which pulls latest quotes
- **Without quotes:** `placeOrder()` returns `{ success: false, error: "No quote available" }`

---

## Integration with the App

### Frontend Pages
- **Positions Monitor** (`/trading/positions-monitor`): Paper positions appear alongside MT5/T212 positions (filterable by source)
- **Performance Dashboard** (`/builder/performance-lab`): Paper trade history contributes to P&L and win rate
- **Create Strategy** (`/trading/create-strategy`): "Paper Trading" is a broker account option — select it to run a strategy against the virtual account

### Automation Loop
When the automation loop is running:
1. Scoring strategies produce ranked symbols
2. Trading strategies evaluate signals
3. If a strategy's broker is set to "paper", orders route through `PaperTradingService` instead of `Mt5TradingService`
4. The loop calls `markToMarket()` each tick to enforce SL/TP

---

## Safety Notes

- Paper trading is **always safe** — no real money, no broker connection needed
- The `mode: 'auto'` setting on a strategy + paper broker = fully automated paper testing
- Never set a strategy to `mode: 'auto'` with `brokerId: 'mt5'` unless you're ready for live trading
- The **Trading Gates** (3-gate pipeline) still apply to paper trades — minimum composite 60, session hours, max 5 positions
