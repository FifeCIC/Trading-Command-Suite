## Problem

Several META.Stacks **cannot work on MetaQuotes-Demo** (the only currently-working broker) because the required symbols are not tradeable/available there. Until another broker is signed up and working, these stacks are dead-ends.

| META.Stack | Symbol | Problem on MetaQuotes-Demo |
|---|---|---|
| US SPY Speed / SP500 Scalp | `SPX500` / `US500` | **US500 tradeMode=0 (DISABLED)**, SPX500 not present |
| VIX Spike Scalp | `VIX` | Not in symbol list |
| Oil Supply Shock | `USOIL` | Not in symbol list |
| BTC Speed Scalp | `BTC` / `BTC-USD` | Not in symbol list |

## Task

### A. Broker sign-up (blocking — primary focus)
Getting another broker working is the current #1 blocker. Sign up / configure one that supports equities + indices + commodities + crypto:

- [ ] **ICMarkets (demo)** — ICMarketsSC-Demo (`51866583`) configured in `.env` but **not yet connecting** (password/server verification needed to activate switch)
- [ ] **Pepperstone (demo)** — `Pepperstone-MT5-Demo` (`461226948`) in `.env`, server name needs verification
- [ ] **MetaQuotes add-on / other MT5 server** that lists indices (US500/SPX500) + commodities (USOIL) + crypto (BTCUSD)
- [ ] **Capital.com (demo)** — API keys configured, verify chart/account access for indices/crypto
- [ ] **Alpaca (paper)** — supports US equities + SPX/QQQ proxies (paper trading, free)

### B. Once a supporting broker is live — enable the blocked stacks
- [ ] US SPY Speed / SP500 Scalp (requires a broker listing US500/SPX500)
- [ ] VIX Spike Scalp (requires a broker with VIX)
- [ ] Oil Supply Shock (requires a broker with USOIL)
- [ ] BTC Speed Scalp (requires a broker with BTCUSD)

### C. Set active broker and verify
- [ ] Switch `MT5_ACTIVE_ACCOUNT` to the newly-working broker
- [ ] Confirm all target symbols tradeable (tradeMode=4) on the new broker
- [ ] Re-run the per-asset META.Stack establish issues for the newly-unblocked assets

## Acceptance
- [ ] At least one additional broker connecting in a demo/paper state
- [ ] Indices (US500/SPX500), commodities (USOIL), and crypto (BTCUSD) confirmed tradeable on it
- [ ] The 4 blocked stacks activated and producing signals
