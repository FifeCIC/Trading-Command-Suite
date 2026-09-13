# Symbol data coverage audit — 2026-09-10

> **Status:** dated audit (category B working record). Findings reflect the database as at
> 2026-09-10. Open fix options below are tracked on issues — this file is not a to-do list.

**Method:** joined `symbol` (registry intent) with `marketbar.provider` + freshness (delivery),
then cross-checked against `GET http://localhost:5000/symbols` (12,411 MT5 symbols) for the
MT5-sourced set. Sources of truth used: the **DB** for what actually arrived, the **broker
list** for what MT5 can supply.

> **Correction to an earlier claim in this session.** I initially reported that VIX, UKOIL and
> NATGAS were un-tradeable because MT5 does not offer them. That was wrong for **VIX**: it is
> live with 5,674 bars updating to 14:01, sourced via MT5. The `/quote?symbol=VIX` probe I used
> 404s for symbols that fetch fine via the bars endpoint, so my probe was not a valid test of
> availability. The audit below uses the `provider` column and bar freshness instead, which
> reflects what actually happened rather than what one endpoint answers.

## The registry is backed by TWO providers, not one

The `exchange` column is a **legacy label** and does not reflect the delivering provider. The
authoritative field is `marketbar.provider`:

| `marketbar.provider` | Symbols | Status |
|---|---|---|
| `mt5` | 27 | **live** — newest 14:01, refreshed every 5 min |
| `binance` | 3 | **stale** — nothing newer than 2026-08-25 |
| *(none)* | 4 | **never delivered a single row** |

`exchange = 'Xtrend'` appears on 21 symbols, but **there is no Xtrend adapter** in
`src/modules/providers/`. The label is vestigial; delivery is MT5 for those symbols.

## Three distinct failure modes — each needs a different fix

### Mode A — `mt5`, fresh, working (11 symbols) ✅

`XAUUSD, XAGUSD, EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD, UK100, FRA40, GER40, VIX`

These are the system's real trading universe right now. Everything scoring and trading comes
from this set.

### Mode B — `binance`, stale (3 symbols) ❌

| Symbol | Bars | Newest | Stale |
|---|---|---|---|
| `BTCUSD` | 177 | 2026-07-18 | 54 days |
| `DOGEUSD` | 200 | 2026-08-02 | 39 days |
| `BTC-USD` | 200 | 2026-08-25 | 16 days |

A `binance` adapter **exists** (`binance.adapter.ts`), but `BarRefreshService` only ever calls
`adapterFactory.create('mt5')` — so nothing refreshes them. They were populated once, long ago,
and have aged out ever since.

Note `BTCUSD` **and** `BTC-USD` are both present, both `binance`, both stale, and both assigned
to `btc-scalp-v1` (an inactive protocol). Two registry entries for one instrument, neither
live.

**Fix:** either route crypto through the binance adapter in the refresh loop, or point these at
MT5's `BTC`. Both are real options; which one is right depends on whether crypto is intended to
be traded at all.

### Mode C — never delivered a single row (4 symbols) ❌

| Symbol | MT5 offers this ticker? | Assigned to |
|---|---|---|
| `DJI30` | ❌ no | — |
| `SPX500` | ❌ no | spy-day-v1, spy-speed-v1 |
| `TECH100` | ❌ no | qqq-day-v1, qqq-speed-v1 |
| `USOIL` | ❌ no | oil-speed-v1 |

These have **zero bars, ever**. They show as `starvedSymbols` with `missing=[5m,15m,1h,4h,1d]`.

**MT5 offers the same instruments under other names:**

| Registry | MT5 name (verified present in the 12,411 list) |
|---|---|
| `SPX500` | `US500` |
| `TECH100` | `USTEC` |
| `DJI30` | `US30` |
| `USOIL` | `WTI` |
| `GER40` | *already works* — MT5 accepts `GER40` |

So **three of the four are naming mismatches, not capability gaps.** `spy-day-v1`,
`spy-speed-v1`, `qqq-day-v1` and `qqq-speed-v1` are four ACTIVE protocols that cannot score
because their symbol is spelled wrong. This is likely a significant chunk of the "why so few
trades" question.

**`US30` deserves mention:** it is `mt5`-sourced with 1,400 bars, but newest is **2026-07-24** —
47 days stale. So it was fetched at some point and then stopped, while other MT5 symbols
continued. That is a different symptom from Mode C and worth its own look.

## Not tradable on this account (a capability gap, not a naming bug)

| Symbol | Note |
|---|---|
| `UKOIL` | No Brent contract in the MT5 list at all |
| `NATGAS` | No natural-gas contract in the MT5 list at all |

Unlike VIX (which works), these genuinely have no MT5 equivalent. `oil-speed-v1` can only ever
run on `WTI` once `USOIL` is corrected.

## Recommended actions

1. **Rename the four Mode-C tickers to their MT5 names** (`SPX500→US500`, `TECH100→USTEC`,
   `DJI30→US30`, `USOIL→WTI`). Highest value: unblocks four active protocols. Requires deciding
   whether `DJI30` merges into the existing stale `US30` row or replaces it.
2. **Decide crypto.** Route `BTC`/`ETH`/`SOL`/`DOGE` through binance in the refresh loop, or
   drop the crypto protocols. Right now they are registry entries that cannot produce data.
3. **Deactivate or flag `UKOIL` and `NATGAS`** — no instrument exists on this account.
4. **Investigate the stale `US30`** separately; it is the only MT5 symbol that stopped.

`starvedSymbols` on `/api/market-data/bars/refresh/status` now reports all of this
automatically, with age and the exact missing timeframes.
