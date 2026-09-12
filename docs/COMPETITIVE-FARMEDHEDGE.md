# Competitive Analysis — TCS vs FarmedHedge Pair Trading Dashboard

> **Created 2026-09-12.** Requested by the owner: *"compare to the best sellers and aim to challenge them."*
> Target: **FarmedHedge Pair Trading Dashboard** ($490, 5★, 10 activations) — the highest-priced
> utility observed on the MQL5 Market.
>
> ⚠️ **All TCS capability claims below are from reading the code on 2026-09-12.** Where something
> is an estimate, it is labelled. Where something is unverified, it says so.

---

## 1. The headline finding

> ⚠️ **TCS already contains BOTH halves of pair trading — and has never joined them.**

| FarmedHedge component | TCS equivalent | Status |
|---|---|---|
| **Sync Rate (SR)** — correlation between pairs | `portfolio/correlation.service.ts` — Pearson matrix, all symbols, daily 06:00 | ✅ **EXISTS** |
| **Farm Index (FI)** — normalised deviation, mean-reversion entry | `sigma-score.directive.ts` — *"Z-Score of log returns… mean-reversion at extremes"*, ±2σ/±3σ | ✅ **EXISTS** |
| **FI applied to a PAIR SPREAD** | — | ❌ **THE GAP** |

### Why this matters

`sigma-score` computes a z-score of **one instrument's log returns**.
FarmedHedge's Farm Index computes an equivalent normalisation of **the spread between two
correlated instruments**.

**Same mathematics. Different object.** TCS has the formula and never points it at a pair.

### ⚠️ And the correlation is computed then thrown away

`correlationPair` is written by `correlation.service.ts` and read by **`database-stats.controller.ts`
— a row-count endpoint.** **Nothing trades on it.**

This is the "buried ability" pattern from the owner's own memory notes: *a mechanism that exists
in code with zero surface*. The daily 06:00 correlation job has been running and its output
consumed by a statistics page.

---

## 2. Feature-by-feature

### Core pair-trading engine

| Feature | FarmedHedge | TCS | Work needed |
|---|---|---|---|
| Correlation / sync-rate scan | ✅ | ✅ **Pearson matrix, 90-day window, all symbols** | None — exists |
| Normalised deviation metric | ✅ Farm Index | ✅ sigma-score (±2σ/±3σ) | **Point it at a spread** |
| Pair spread series | ✅ | ❌ | **New — moderate** |
| Pair entry at extreme | ✅ FI >200 / −200 | ⚠️ per-instrument only | Moderate |
| Pair exit at mean reversion | ✅ FI → 50–100 | ⚠️ per-instrument only | Moderate |
| Pair scan ranking | ✅ | ⚠️ matrix exists, no ranking | Low |
| **Two-leg execution** | ✅ | ❌ **not implemented** | ⚠️ **Highest risk item** |

### Trading modes

| Feature | FarmedHedge | TCS |
|---|---|---|
| Manual trading | ✅ dashboard | ✅ `Mt5TradingPage.jsx` with `handlePlaceOrder` |
| Hybrid (manual entry, auto TP/SL) | ✅ | ✅ stop guardian + trailing |
| Full auto | ⚠️ "not the main purpose" | ✅ **automation loop, 19 protocols, scheduled** |
| Cooldown after stop-loss | ✅ | ⚠️ unverified |

### Risk management

| Feature | FarmedHedge | TCS |
|---|---|---|
| Max open positions | ✅ | ✅ `maxPositions: 5` |
| Max drawdown protection | ✅ | ✅ `maxDrawdown 25%`, warning at 12% |
| Spread monitoring | ✅ | ⚠️ **unverified** |
| Max FI / SR filters | ✅ | ⚠️ as directive thresholds |
| **Risk gating engine** | ❌ | ✅ **dedicated `RiskGatingEngine` — gates each protocol** |
| Stop guardian | ❌ | ✅ `StopGuardianService` — adjusts live stops |
| Weekend gap risk | ❌ | ✅ `weekend-gap-risk.service.ts` |
| Monte Carlo | ❌ | ✅ `monte-carlo.service.ts` |

**TCS's risk layer is substantially deeper than FarmedHedge's.**

### Analysis & infrastructure

| Feature | FarmedHedge | TCS |
|---|---|---|
| Multi-asset | ✅ Forex/Crypto/Stocks/Commodities/Indices | ✅ 242 symbols, 15 provider adapters |
| Backtesting | ⚠️ Strategy Tester only | ✅ dedicated backtest module + archive |
| A/B testing | ❌ | ✅ `ab-test.service.ts` |
| Signal/outcome learning | ❌ | ✅ `directiveoutcome`, 12,171 matured rows |
| Protocol/stategy builder | ❌ | ✅ protocol + strategy builders |
| Directives engine | ❌ | ✅ **155 directives** |
| Web UI pages | ⚠️ MT5 panel | ✅ **162 pages** |
| Themes | ❌ | ✅ theme packs |
| Multi-timeframe | ✅ H1–H4 | ✅ 1m–1w |

---

## 3. What TCS already has that FarmedHedge does not

Ranked by how hard they would be for FarmedHedge to replicate:

| # | Capability | Why FarmedHedge likely can't |
|---|---|---|
| 1 | **155-directive scoring engine** | Different architecture entirely |
| 2 | **Outcome learning loop** (12,171 matured predictions) | Requires a database; MQL5 EAs are stateless |
| 3 | **162-page web UI** | MT5 panels are constrained to chart objects |
| 4 | **15 provider adapters** | EAs see only the broker's feed |
| 5 | **Risk gating engine per protocol** | Not present |
| 6 | **Monte Carlo, A/B testing** | Not present |
| 7 | **Automation loop with 19 protocols** | FarmedHedge explicitly says full automation "is not the main purpose" |
| 8 | **Backtest archive** | MT5 Strategy Tester only |

---

## 4. What FarmedHedge has that TCS does not

| # | Capability | Work to close |
|---|---|---|
| 1 | **Pair-spread trading (core)** | ⚠️ **Substantial — see §5** |
| 2 | Two-leg position management | ⚠️ Substantial |
| 3 | A single installable MT5 binary | ⚠️ Packaging (see `DEPLOYMENT-MT5-OFFERING.md`) |
| 4 | **10 activations / 5★ track record** | ⚠️ **Not an engineering problem** |
| 5 | Farm-Index chart tool | Low — UI |
| 6 | Free demo version | Low |
| 7 | Setup guides in-product | Low |

---

## 5. Work required — honest estimate

⚠️ I am **not** giving hour counts. I have not read the execution path end-to-end and you have
repeatedly (correctly) pushed back on confident estimates. What I can give is **relative size and
risk**.

| Work item | Size | Risk | Notes |
|---|---|---|---|
| **Pair-spread service** — build spread series from two symbols | **Moderate** | Low | Both data series exist |
| **Point z-score at the spread** | **Small** | Low | `sigma-score` logic is reusable |
| **Sync-rate gate from `correlationPair`** | **Small** | Low | Data already computed daily |
| **Pair ranking / scan endpoint + page** | **Moderate** | Low | 162 pages as pattern reference |
| **Two-leg execution** — open/close both legs atomically | ⚠️ **Substantial** | ⚠️ **High** | Partial fills, one-leg-fails, netting vs hedging accounts, per-leg stops |
| **Pair risk rules** — max pairs, correlation-drift stop | Moderate | Medium | `RiskGatingEngine` is the right home |
| **MT5 packaging** | Substantial | Medium | Separate track — see deployment doc |

### The item to worry about

⚠️ **Two-leg execution is where this becomes hard.** FarmedHedge has shipped it; it is the part
most likely to lose money when it goes wrong — one leg filled and the other not leaves an
**unhedged directional position**, which is exactly what pair trading exists to avoid.

MT5 **netting vs hedging account mode** changes the implementation fundamentally. This needs to be
designed before it is coded, and it belongs in the "treat as production" category from
`development-status.instructions.md` (money-moving paths).

---

## 6. Assessment — should you challenge them?

### Where you would win

| Dimension | Verdict |
|---|---|
| Breadth of analysis | ✅ **Far ahead** — 155 directives vs one metric |
| Risk infrastructure | ✅ **Ahead** — gating engine, stop guardian, Monte Carlo |
| Automation | ✅ **Ahead** — FarmedHedge explicitly de-emphasises it |
| UI | ✅ **Far ahead** — 162 pages vs a chart panel |
| Outcome learning | ✅ **Unique** — nobody in this market has it |

### Where you would lose

| Dimension | Verdict |
|---|---|
| **Pair trading core** | ❌ **Not built** |
| **Packaging** | ❌ Web app cannot list on MQL5 Market |
| **Track record** | ❌ 0 activations, 0 reviews, unproven edge |
| **Simplicity** | ⚠️ FarmedHedge is one install; this is a stack |

### ⚠️ The strategic question I would put back to you

**FarmedHedge is a $490 single-purpose tool. TCS is a platform.**

Going head-to-head on *pair trading* means competing on FarmedHedge's home ground, where they have
a shipped product and you do not. But **pair trading is a small part of what TCS already is** — and
the two halves are already sitting in your codebase.

**Three positions you could take:**

| Position | Logic |
|---|---|
| **A. Build the pair module** | Head-to-head; uses existing correlation + z-score. Sub-portion of platform |
| **B. Don't build it — position as the platform** | FarmedHedge is one strategy; TCS hosts many. Different market |
| **C. Build it as a *differentiator*** | "Every strategy, plus pair trading, plus outcome learning" — but that is a lot to prove with 0 users |

**My read:** the pair module is **genuinely cheap for you relative to anyone else** — you have both
halves already. But ⚠️ **the two-leg execution risk is real**, and building it does not address the
two blockers that matter for selling: **packaging** and **proven edge**.

---

## 7. Recommended order

| # | Action | Rationale |
|---|---|---|
| 1 | **Verify two-leg execution feasibility** against MT5 hedging/netting | ⚠️ Highest-risk unknown — do this before building the rest |
| 2 | Land the **pair-spread + z-score** service (read-only, signals only) | Cheap, no money at risk, produces visible output |
| 3 | Add pair signals to the dashboard | Reuses existing page patterns |
| 4 | **Only then** wire two-leg execution | Money-moving — last, with full verification |
| 5 | ⚠️ Treat packaging and edge as **separate tracks** | Neither is solved by the pair module |

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-09-12 | Created. Source review of FarmedHedge feature list. TCS capability verified in code. **Key finding: correlation + z-score both exist; pair spread never built; `correlationPair` consumed only by a stats endpoint.** |
