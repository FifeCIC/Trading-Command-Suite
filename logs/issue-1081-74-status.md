## §7.4 status — re-measured 2026-10-07. **Items 1, 3 and 4 are DONE**, and the order of work below is corrected.

> **Why this comment exists.** §7.4 is written as outstanding work, and this sprint's first pass says to start
> there (*"small, fully specified, unblocks trustworthy comparisons"*). Measuring before working it shows most
> of it is already built, guarded and live. **A plan that lists finished work as outstanding is not neutral** —
> it sends the next agent to build a second copy of something that exists, which is this repo's most expensive
> kind of debt. Records corrected: this issue's §7.4, and **row 26** of `docs/SETTLED-DECISIONS.md`, whose
> 🔴 *"a backtest verdict can be issued on 1 trade"* is no longer true.

### Item by item

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Sample bar on `runs/compare` | ✅ **DONE** | see below |
| 2 | `compare` vs `run` disagreement | ⚠️ **NOT MEASURED** | `netPnl` / `maxTradeDrawdown` exist on the run record; the 2026-09-23 figures have **not** been re-checked, so do not quote them |
| 3 | Backtest a BOT via `botId` | ✅ **DONE** | `BacktestRunRequest.botId` accepted; an **unresolvable bot REFUSES** rather than falling back to an unscoped run |
| 4 | Pair comparison + like-for-like | 🟡 **PARTIAL** | the like-for-like **lot-size warning** is live; there is **no first-class pair object** in backtest (`grep pairId\|derivedFrom\|abPair` → *no matches*) |
| 5 | #819 replay view | ❓ **unmeasured** | `GET /api/backtest/replay/:runId` **exists**; the UI is not assessed here |
| 6 | #962 rename | ❌ **NOT DONE** | row 24 still 🔴 — 87 references across 30 files |

### Item 1 — the bar, observed live (not asserted)

`POST /api/backtest/runs/compare`, two runs at 22 and 24 trades, 2026-10-07:

```
best      : null
verdict   : insufficient-data
metric    : null
required  : 30
n         : {"btc-speed-v1 @5m trades":22, ... "btc-speed-v1 @1h signals":24}
note      : Refusing to name a winner: ... (need ≥30 per side). A verdict on a smaller sample is
            noise wearing a result's clothes (#929). ... ⚠️ NOT LIKE-FOR-LIKE — the bots' LOT SIZE
            is UNKNOWN for btc-speed-v1 @5m ...
```

- **Both populations** are assessed — trades *and* entry signals — so the verdict's own metric cannot rest
  on an unstated sample. Shared bar: `MIN_SAMPLES_FOR_VERDICT` via `common/trading/verdict-bar.ts`.
- Guarded **both ways**: `backtest.service.spec.ts` (thin → not named; thick → named) —
  `npx jest src/modules/backtest` → **4 suites / 61 tests pass**.

### What is genuinely left for "backtesting A/B pairs"

⚠️ **The measurement machinery is ready; the PAIR is not first-class.** Today a pair backtest is *three manual
calls* — run A, run B, compare — with the operator responsible for keeping symbol, window and bars identical
between them. Row 26 already settled that **the backtest is the instrument** (not the live pair), so this is
the gap that matters for the owner's goal of *"backtesting A/B pairs"* being truly ready.

⚠️ **And one data finding blocks trusting any backtest of a VIX pair**: VIX 1m bars are **73% a repeated
constant** (10,947 of 15,041 flat, **124 distinct closes** — against 2,357–11,047 for every other instrument
measured), still being written today. **Filed as #1084.** A backtest is only as good as its bars.

### Not done by this comment

No item above was *executed* by writing this — it is a re-measurement and a correction. Items 2 and 5 are
unmeasured rather than passing, and are named so they are not read as done.
