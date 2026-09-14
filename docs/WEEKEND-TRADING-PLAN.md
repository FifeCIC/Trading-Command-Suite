# Weekend Trading — Groundwork for Path A and Path B

**Status:** PLANNING ONLY. No code written. Decisions required before implementation.
**Date:** 2026-09-13 · **Owner decision pending** on the schedule model (see §5)

---

## 1. The headline finding — Path A is mostly already built

I expected to have to build weekend crypto support. **Most of it exists.** Before writing any
code, this is what was measured:

| Capability | State | Evidence |
|---|---|---|
| Crypto routes to Binance | ✅ **Works** | `symbol_route`: BTC/ETH/DOGE/SOL → `provider='binance'` |
| Bar refresh uses those routes | ✅ **Works** | `bar-refresh.service.ts` L399–432 routes by `symbol_route.provider` (#760) |
| Binance candles reach the DB | ✅ **Verified** | `marketbar` has BTC/DOGE/ETH/SOL rows with `provider='binance'` across 1m–1d |
| Weekend reads as **open** for crypto | ✅ **Works** | `computeMarketStatus()` is bar-freshness based and symbol-agnostic — crypto keeps printing bars so it never trips the staleness test |
| Crypto classified 24h | ✅ **Works** | `is24HourMarket()` treats crypto pairs as 24/7 |
| Crypto weekend directive | ✅ **Exists** | `crypto-weekend-effect.directive.ts` |
| Crypto symbol assignments | ✅ **Partially** | `btc-scalp-v1` assigned BTC, ETH, SOL |
| Crypto protocols active | ❌ **All `active=0`** | `btc-scalp-v1`, `btc-speed-v1`, `doge-speed-v1` |
| Crypto bots | ❌ **Zero** | No `trading_strategy` rows |
| Binance **order placement** | ❌ **Does not exist** | `BinanceAdapter` implements `getCandles`/`getQuote`/`getProfile`/`healthCheck` only |

**⚠️ The critical architectural point:** `market-status.ts` is deliberately symbol-agnostic —
*"Crypto (24/7) keeps producing bars so it always reads `open`; gold/forex freeze over the
weekend so they read `closed`."* This means **the existing gate already does the right thing
per instrument**. Nothing needs overriding to let crypto score on a Saturday.

---

## 2. Path A — weekend crypto SCORING (read-only, no execution)

**Purpose:** produce analysis and score history over weekends. No orders. No money.

### What it actually requires

| # | Task | Type | Notes |
|---|---|---|---|
| A1 | Activate `btc-scalp-v1`, `btc-speed-v1`, `doge-speed-v1` | **Config** | `active=1` |
| A2 | Confirm `resolveSymbols()` returns symbols for each | **Verify** | `btc-scalp-v1` has assignments; `btc-speed-v1` uses a `btc-speed-index` watchlist FK |
| A3 | Ensure `bar-refresh` includes crypto in its working set | **Verify** | It routes correctly, but does the symbol set include crypto when the stack is idle? |
| A4 | Confirm Binance freshness on a weekend | **Verify** | Data was 3 days stale when measured — stack was down, not a routing fault |
| A5 | **No bot.** Leave `trading_strategy` empty for crypto | **Deliberate** | Scoring without dispatch = zero execution risk |
| A6 | Guard: no crypto protocol may be assigned a bot | **Guard** | Otherwise Path A silently becomes Path B |

**Estimated effort: small.** Mostly activation + verification, not new code.

### The one real risk

**A protocol with no bot still writes to the shared `score` table** (see #803 — `SpeedScanService`
persists regardless of `active`). So activating crypto protocols **adds rows that mix with MT5
scores** unless the analysis excludes by symbol. Worth confirming before activating.

### What it delivers

- Weekend score history for BTC/ETH/DOGE/SOL
- A live test of the weekend path with **no money at risk**
- Evidence for whether crypto directives produce sane scores before wiring execution

---

## 3. Path B — weekend crypto EXECUTION (real orders)

**Purpose:** actually trade crypto over the weekend. **This is a money path** — per
`development-status.instructions.md` it gets full care, full verification, no shortcuts.

### What it requires

| # | Task | Notes |
|---|---|---|
| B1 | `BinanceAdapter.placeOrder()` | Does not exist. Needs HMAC-SHA256 request signing, `X-MBX-APIKEY` header |
| B2 | Order lifecycle | Place / query / cancel. MT5's adapter is the reference implementation |
| B3 | Credentials | `BINANCE_API_KEY` / `BINANCE_API_SECRET` are referenced in `providers.module.ts` but currently **unconfigured** |
| B4 | `position-sync` support for binance | Currently MT5-shaped (tickets, magic numbers) |
| B5 | Duplicate guard / pyramid / risk checks | All assume MT5 semantics — must not silently mis-handle crypto |
| B6 | Fee/slippage model | Crypto taker fees + weekend spread widening are not in any current calc |
| B7 | Demo/paper verification | **Binance has a testnet** — proves the path without real money |
| B8 | A bot with `mode='auto'` on a crypto protocol | The execution trigger |

**Estimated effort: substantial.** This is a new broker integration, not a config change.

### ⚠️ Recommendation: do NOT build B yet

Two measured reasons:

1. **The edge question is unresolved.** 32 valid trades at **31.3%** against a **32.2%** break-even
   line. Adding a new instrument class with real execution means more unmeasured trades on an
   unvalidated system.
2. **Crypto is the worst place to start measuring.** Weekend crypto has the thinnest liquidity and
   widest spreads of the week — the exact conditions where a marginal edge disappears.

**Path B is worth doing *after* the edge question is answered, not before.**

---

## 4. The existing schedule mechanism (and its gap)

A session gate **already exists** — this is important, because the "new thing" is smaller than
it appears.

```
session-window.ts          → SESSION_DEFS, checkSessionWindow()   (pure, no DI)
trading_strategy.sessionWindow  → the stored setting (bot level)
automation-loop Gate 4.5   → enforces it in processSignalQueues()
```

| Property | Current state |
|---|---|
| Where it lives | **`trading_strategy`** (bot), **not** protocol |
| Tags | `'asian' \| 'london' \| 'us'` — **no weekend/day concept** |
| `null` | **UNGATED** — may act any time |
| Aliases | City words accepted, flagged as a hazard (#759) |

### ⚠️ The gap that matters for weekend trading

**There is no day-of-week concept anywhere in the schedule model.** `checkSessionWindow()`
evaluates time-of-day only. So:

- A bot with `sessionWindow = null` (ungated) **would trade on a Saturday** — but so would it on a
  Tuesday, which is not "weekend only".
- There is **no way to express "Saturdays and Sundays only"**.

**This is the genuinely new thing.**

---

## 5. ⚠️ The decision I need from you before building

**Q1 — Does the schedule belong to the protocol or the bot?**

You said protocols. But two facts complicate it:

- The execution path reads `trading_strategy.sessionWindow` (Gate 4.5).
- Two bots could share one protocol but need different windows.

Three options:

| Option | Model | Trade-off |
|---|---|---|
| **1. Bot-level only** | Extend existing `trading_strategy.sessionWindow` with day tags | Smallest change; but contradicts "protocols" |
| **2. Protocol-level** | New `protocol.schedule`; bots inherit it | Matches your intent; needs Gate 4.5 to read a joined value |
| **3. Both** | Protocol default + bot override | Most flexible; most confusing — two places to look |

**I'd suggest Option 2** to match your stated intent, with the bot's existing `sessionWindow`
kept as an override only if a real need appears.

**Q2 — What is a "window"?** Options for the model:

- **Day-of-week set** — `{ sat, sun }` — simple, expresses "weekend only"
- **Named windows** — reuse `SESSION_DEFS` + add `weekend` / `crypto-247`
- **Cron-like** — most flexible, hardest to explain in the UI

**I'd suggest named windows**, because `SESSION_DEFS` already exists as the single source of
truth and adding a `weekend` / `'24-7'` definition keeps one vocabulary.

**Q3 — Should "weekend only" be a hard rule or a preference?** If a crypto bot's window is
`weekend` and it's Wednesday, is that a skip (like the session gate) or an error surfaced in the UI?

---

## 6. Sequencing I'd recommend

| Step | Work | Risk | Gate |
|---|---|---|---|
| **1** | Decide Q1–Q3 | none | you |
| **2** | Add day-of-week to `session-window.ts` + tests | none | pure functions, no money |
| **3** | Wire the schedule to protocols | none | config/read path |
| **4** | **Path A** — activate crypto protocols, no bots | none | scoring only |
| **5** | Observe a weekend of crypto scores | none | evidence |
| **6** | Revisit edge question with more MT5 trades | none | the actual goal |
| **7** | **Path B** — Binance execution | **money path** | only after step 6 resolves |

**Steps 2–5 are safe and unblock your weekend ambition without touching money.** Step 7 should
wait.

---

## 7. Related work already recorded

- **#760** — provider routing (this is why crypto data works)
- **#803** — inactive protocols still score & persist (affects A1)
- **#805** — P&L measurement counted invalid rows
- **#772/#770** — the VIX short wiring; the same "protocol has no bot ⇒ can never dispatch" trap applies to crypto
- `database-seed-discipline.instructions.md` — **crypto routes have no seeder (#804)**. Activating
  crypto protocols via DB alone will be lost on reinstall.

---

## 8. Trading212 portfolio refresh (raised 2026-09-13)

Owner note: *the Trading212 API is not great, but a **daily** query should update portfolio data
at least once; actions to manage the portfolio from within TCS are a separate matter, and a minor
amount of work is acceptable to progress API use.*

Measured state: **21 Trading212 rows, last synced 2026-09-08 (5 days stale)** while MT5 syncs
fresh. **This staleness is on the shares side only.**

⚠️ These 21 rows are **holdings, not trading positions** — `side` is NULL on all of them, and they
are `provider='trading212'`. They must be kept distinct from MT5 positions in any count or view;
conflating them is what produced the earlier "29 positions" error.

Recommended: a scheduled once-daily sync, and a clear separation in the data model/UI between
**investments** (Trading212 shares) and **trading positions** (MT5). Filed as its own issue.
