# Trading Bot Model — "The Whole Pipeline Is the Strategy"

> **Status:** Design intent (2026-09-02, user-confirmed direction). Canonical reference for the
> Trading Agent and any agent touching the automation/execution path. Supersedes the old
> "Trading Strategy = symbol-named strategy" mental model.
> **Related:** #674 (strategy redefinition), #624 (terminology — display-first), #574 (execution
> semantics), #714 (signal queues / single scoring line), #712 (protocol subscriptions).

---

## 1. The core insight

**A "strategy" is the whole pipeline — not the final wrapper.**

The app is slowly moving away from a confused "Trading Strategies" area toward a clean separation:

| Layer | What it is | What it produces | Who owns it |
|-------|-----------|------------------|-------------|
| **Protocol** | The **signal thesis** — which symbols/timeframes/directives, and a declared **direction** | BUY / HOLD / SELL signals per symbol | Signal engine (SEES) |
| **Trading Bot** (a `TradingStrategy` DB row) | The **execution policy** — money management, risk, entry/exit rules, position building, reserves | A queue head acted on, or a deliberate skip | The bot itself |
| **Complete strategy** | Protocol (signal source) **+** Bot (execution policy) | A trade, correctly sized and guarded | The pipeline |

Once a signal is produced it is **queued to a specific bot**; the bot decides *whether* to execute
based on money/risk/position reality — it does **not** re-derive the signal.

### ⚠️ 1b. THERE ARE THREE TABLES CALLED "STRATEGY" — measured 2026-09-18

This is the most confusing thing in the codebase, and the §1 table above does not warn about it.
Three separate Prisma models, all meaning something different, all named "strategy":

| Prisma model | Table | Rows | What it ACTUALLY is |
|---|---|---|---|
| `Strategy` | `strategy` | 29 | A named container: `{name, description, version, config}`. **This is the "strategy" in the §1 sense** — the idea, with its own name and id |
| `TradingStrategy` | `trading_strategy` | 26 | **A BOT.** The execution policy. Named `TradingStrategy` because it predates this document |
| `ScoringStrategy` | `scoring_strategy` | 27 | Scoring + trade params for a protocol path (`protocolId`, `watchlistName`, `tradeThreshold`, `gateConfig`) |

**How it got this way.** `Strategy` is the ORIGINAL top-level entity — it owns `directives`,
`scores`, `signals` and `versions` by relation. The META.Stack refactor moved directives under
**Protocol** (`directive.strategyId` is now **0 of 101 populated**) and introduced `TradingStrategy`
for the execution layer. The old table was never retired, and the UI began calling the NEW rows
"strategies".

**What still uses `strategy`.** `score.strategyId` is **4471 of 4494 populated and joins
`strategy.id`** — checked against `scoring_strategy.id`, which matches **0**. The scoring pipeline
still writes scores against a `strategy` row.

**Where the 29 rows come from — measured:**

| Kind | Count | Example name |
|---|---|---|
| Auto-generated, one per protocol | **28** | `Signals Workbench → cac-speed-v1` |
| Hand-named | **1** | `Conviction Dip Accumulation` |

So the owner's question — *"strategies ARE generated when certain other things are made?"* — is
**correct**: a `strategy` row is created per protocol for scoring. That is why listing them feels
like listing protocols.

The single hand-named row is the shape §5's naming rule describes, and the shape a user would
recognise:

```
name:        Conviction Dip Accumulation
description: Soft long-only, share-buying. Accumulate on quality dips; hold through normal drawdown.
config:      { "weights": {}, "entryThreshold": 60, "watchThreshold": 40, "defenseThreshold": 25 }
```

**Rules for agents, until this is resolved:**

1. **A "bot" is a `trading_strategy` row. A "strategy" is a `strategy` row.** Different tables,
   different ideas. Say which you mean.
2. **`TradingStrategy` is a bot**, despite the name. Do not treat the model name as evidence of what
   the row is.
3. Four Trading-menu views are labelled "strategy" but render BOTS: `strategy-monitor`,
   `trading-strategies`, `strategy-comparison`, `strategy-library`. Use "Trading Bots" for the
   execution layer, per §5.
4. **NOT DECIDED:** whether the auto-generated per-protocol `strategy` rows should exist at all, or
   whether a strategy should only come into being when a human names one. Raise it; do not assume
   either answer.

### 1c. How to COUNT strategies — the owner's definition (2026-09-18)

> *"A strategy is about different treatment of a symbol."* — the project owner

**The rule, as given (corrected 2026-09-18 — this supersedes the earlier version):**

> *"Two different bots results in two strategies."*
> *"Different markets. Is different configuration therefore the end result is a unique strategy."*
> *"The smallest change results in a different strategy because we cannot dismiss the power any
> single setting/behaviour could have on the stock market."*
> *"we should never have bots that do the exact same thing, even if it has different naming, it
> would mean its a duplicate and should be avoided"*

- **A strategy IS a bot's whole configuration**: protocol + role + **market** + broker + execution
  policy.
- **Any difference at all makes a different strategy.** No field can be dismissed, however trivial
  the difference looks — that is the owner's explicit position.
- **A different market IS a different configuration.** Six bots on six FX pairs are six strategies.
- **Two byte-identical bots are a DUPLICATE — a defect, not a merge.** Such bots "should never"
  exist. The derivation does not fold them into one tidy row; it groups them (a stable key is what
  makes the fault *detectable*) and **reports** them.

> **Strategies = distinct full configurations.** With no duplicates, that is **one strategy per
> bot**.

**Measured 2026-09-18:**

| Quantity | Value |
|---|---|
| Active protocols | 19 (11 with a bot, **8 with none**) |
| Bots (`trading_strategy`) | 26 |
| (protocol, bot) pairs | 26 = 25 subscriptions + 1 legacy-only |
| **STRATEGIES** | **26** — one per bot |
| **Reachable** (bot has a subscription) | **25** |
| Unreachable (#874 — bot with no subscription) | 1 |
| **Duplicates** | **0** (none exist — verified) |
| `forex-session-v1` strategies | **14** — one per market |
| Watchlists | 42 (26 linked to a protocol) |

### ⚠️ Two corrections, both from the same mistake

An earlier version of this section said **15** strategies, then **18**. Both were wrong. The errors
are kept here because the *shape* of the mistake is the reusable part.

| Attempt | Said | Wrong because |
|---|---|---|
| 1st | **15** | the counting query omitted `sessionWindow`, even though the query that produced the raw rows had printed it (`EURGBP … london`, `AUDUSD … asian`) and the same run printed the with-session figure of **17**, unused |
| 2nd | **18** | the identity *excluded* `symbol`, on the reasoning "symbols are scope, not identity". The owner corrected this: a different market **is** a different configuration |
| **correct** | **26** | every field contributes; identical bots are duplicates |

**Both wrong answers had one shape: treating a field that happened to be UNCHANGED as though it
were not part of the identity.** First `sessionWindow` was dropped from a count; then `symbol` was
dropped from the identity. The rule is now the opposite and simpler:

> **Every field contributes. If two bots differ in ANY field they are different strategies; if they
> differ in NO field they are duplicates, which is a defect.**

The guard (`nest/scripts/verify-strategy-derivation.ts`) asserts all of these numbers, including the
canonicalisation rules, so neither error can recur silently.

⚠️ `signals-workbench` is counted among the 8 boted-less protocols but is **not a real trading
protocol** (no trading style, no timeframe); it is the workbench container. Filter it before using
that number.

### 1d. Strategy Derivation — the META.Stack identity (design, 2026-09-18)

**The gap.** A MetaStack is *defined* in this codebase as **Watchlist + Protocol + Scoring Strategy
+ Trading Strategy** (`stack-performance.service.ts` L4, `scoring.controller.ts` L372) — but it has
**no identity**. `StackPerformanceService.computeAllRatings()` iterates `scoring_strategy` ROWS, so
one row = one "MetaStack". When several bots share a scoring strategy with *different* execution
config, their results are blended into a single rating and **you cannot tell which treatment
works**.

**Measured 2026-09-18 — this is live, not hypothetical:**

| Fact | Value |
|---|---|
| `trading_strategy` rows sharing `scoringStrategyId = auto-forex-session-v1` | **13** |
| Distinct execution treatments among those 13 | **6** |
| Ratings `GET /api/scoring/metastacks/ratings` returns for them | **1** |

The six treatments are: six ungated 5m 0.01-lot bots, three `london`-gated, two `asian`-gated,
`NZDJPY` (**0.1 lots — 10x**), `USDCAD` (5-second timeframe), and `USDJPY` (1h, wider stops). One
blended rating currently covers all thirteen. That is the difference between listing rows and
listing strategies, stated as a measurement.

⚠️ The existing `MetaStackSnapshot.fingerprint` does **not** close this gap: `computeFingerprint()`
hashes fields from `scoring_strategy` **only** (`protocolId, watchlistName, watchlistSymbols,
brokerId, tradeThreshold, baseSize, slPct, tpPct, mode`). Two bots with genuinely different
treatment on the same scoring strategy therefore produce the **same** fingerprint — the drift
detector is blind to exactly the difference that makes them different strategies.

**The derivation rule.**

> A **derived strategy** is a distinct FULL configuration. The `strategyKey` is a stable SHA-256
> over every part — it is the "ID along with the IDs of each part" the owner asked for. Two bots
> share a key only by being byte-identical, which is reported as a duplicate.

```
strategyKey = sha256( protocolId | role | symbol | brokerId | canonicalTreatment ) -> 16 hex

canonicalTreatment = { minComposite, baseSize, slPct, tpPct, maxHoldHours,
                       cooldownMinutes, maxPyramidTiers, timeframe,
                       sessionWindow, mode, maxPositions, maxDailyLoss,
                       useRaritySizing, maxSize }
```

⚠️ **`symbol` and `brokerId` are in the key on purpose.** An earlier version excluded them as
"scope", which collapsed 26 strategies to 18. A different market is a different configuration.

⚠️ **`sessionWindow` is in the key on purpose.** Omitting it is what produced the first wrong
answer (15).

**Canonicalisation must be BEHAVIOURAL, not textual** — two representations of the same
configuration must hash identically, or bots that behave the same are reported as different
strategies. Three rules, each verified by the guard:

| Rule | Why |
|---|---|
| Numbers via `toFixed(6)` | `1` and `1.0` must not hash differently |
| Keys emitted in sorted order | `JSON.stringify` follows insertion order |
| `sessionWindow` through **`parseSessionWindow()`** | **Measured 2026-09-18: 9 bots store a bare `london`, 3 store `["london"]`.** Both are valid, the engine parses them identically, and the parser also folds aliases (`sydney` → `asian`, `zurich` → `london`). A hand-rolled second parser would drift from the one the engine actually uses |
| `null` preserved explicitly | NULL means "ungated" / "no limit" (#773) — a real state, **not** a blank and **not** 0 |

- **Derived** (no name) — computed on every read, never stored. Recomputed when a part changes,
  which is why a config edit *replaces* a key rather than mutating one.
- **Pinned** (named by the owner) — a name plus the part IDs recorded against the key, so the
  strategy survives a part being edited. **This is the follow-up (#875) and is NOT built yet.**
- **Derivation is tracked by #876.** Naming and full-pipeline backup are #875.

**What this enables that does not exist today:** a stable key to attach performance to, a surface
that shows **26 strategies** rather than 26 anonymous rows or 27 blended ratings, and — later — a
snapshot/restore keyed on the STRATEGY rather than on `scoringStrategyId` (see #875).

**Scope boundary.** `MetaStackVersioningService` already snapshots and restores, and
`MetaStackSnapshot` (13 rows) already does the backup the owner described. It is keyed on
`scoringStrategyId`, so it covers 22 of 26 bots and collapses the FX fourteen into one. This is
**widening an existing mechanism, not building a second one** — see #875.

**Verified by** `nest/scripts/verify-strategy-derivation.ts` — 27 assertions driving the real
service against the real database, plus a canary that removes `symbol` from the identity and
confirms the guard fails (26 → 18, and 3 false duplicates detected).

## 2. Signal → bot binding (decision 2026-09-02)

**Approach chosen: the signal locks the bot at enqueue time (Way 1).**

- When `buildBestLadder()` produces an actionable per-protocol record, the routing step assigns it
  to the **applicable active bot** (from the bot's `strategy_protocol` subscriptions) and stores the
  bot on the `strategy_signal_queue` entry. That entry now says: *"execute THIS signal with THIS
  bot — no further routing checks."*
- The **bot** then performs its own checks on its queue head, every tick: *"Do we have funds? Are
  we allowed to open a position now? Does my pacing/money rule allow it?"* — which means the bot
  reads portfolio/positions data continuously.
- **Capability-based assignment (the third approach, preferred for routing):** the protocol declares
  what it needs (asset class, broker, trade style, direction) and the router picks the applicable
  bot from the pool at enqueue, then locks it. This supports **many protocols → one bot** and
  **one symbol in two protocols → two different bots** without hardcoding a 1:1.

> **Rule for agents:** do not re-resolve "protocol → bot" at execution time (Way 2) — assignment
> happens once at enqueue and is locked. Do not reintroduce `compareProtocolPair` /
> `resolveBestSignal` / `evaluateStrategy` (retired #714).

## 3. Broker & trade-type awareness

- Protocols today may not declare a clear **trade type** (stock vs CFD vs forex). Bots need to know
  which broker (and which broker type) a signal can be executed on — e.g. **MT5 original** vs
  **Pepperstone MT5** differ in what they offer.
- This is handled at the **edge**: when a bot is bound to a protocol path, the binding must be
  broker/asset-aware. Many-protocols-to-one-bot makes this tractable — one bot per broker/asset
  family, subscribed to the relevant protocols.

## 4. The pragmatic testing shape (2+ bots, very different intentions)

For proving the model end-to-end we need bots with genuinely different behaviour:

1. **A CFD quick-win bot** — serves a quick-win CFD protocol; takes profit without fuss; may run a
   **faux trailing stop** monitored by the app (not applied to the broker).
2. **A 4h / day-hold bot** — serves a 4h protocol; holds through the day when the trend is strong.

Realistic shape (your NVDA example):
- **`giants` protocol** = NVDA, GOOGLE, AMAZON → traded as **CFD** → a **CFD bot**.
- A separate **tech long-term protocol** also includes NVDA → a **stocks bot**.
- NVDA can therefore appear **twice** in queue data, locked to two different bots, each path
  executable only by its own bot. That is expected and correct.

## 5. Naming — display-first

- A bot should be named by **what it will do**, not by its symbol(s): `Quick Win CFD`,
  `One-Buy Pyramid Investment` (buys more once the prior entry is in profit and locked in),
  `Multi-Buy Pyramid Investment` (e.g. buy 5 symbols, then wait for one to go green before buying
  the next).
- **Display-first:** change user-facing labels (Strategy Monitor, nav, Automation) to "Trading Bots"
  and behaviour-based names **now**; defer any code/DB identifier rename until later.
- The six "FX session" rows are really **one or two behaviour-named bots** (e.g. `Session FX —
  guarded`) subscribed to `forex-session-v1` across symbol scopes — not six distinct "strategies."

## 6. What agents must NOT do (regression guard)

- ❌ Reintroduce a second scoring line or strategy-side scoring (`evaluateStrategy`).
- ❌ Reintroduce the dual LONG-vs-SHORT winner-pick (`compareProtocolPair`) — direction is the
  protocol's job; the bot does not compare two protocols.
- ❌ Treat a `TradingStrategy` row as "a symbol pair to trade" — it is an **execution policy**.
- ❌ Build a separate execution path for MANUAL trades — manual trades call the SAME execution
  library as the bot (sizing, stops, pyramid, cooldowns, trailing), configured by the #720
  defaults when no bot matches. Decisions locked in #721.
- ✅ Keep the one-scoring-line + per-bot queue model documented in `automation-loop.service.ts`.

## 6b. Execution-policy library (2026-09-03, #721)

The bot owns ALL trade-scenario functions — sizing, stop policy, pyramid/scale-in, cooldowns,
trailing management. Manual trades (Signals cards) are just another caller of the same classes
with the #720 default config. Two-layer stops, one rule everywhere:

- **Broker-side protective stop** — relaxed, always set on every position (initial AND follow-ups)
  so an app failure never leaves a position unprotected at the broker.
- **App-managed trailing stop** — tighter, adjusted by the app while it runs.

Pyramid/scale-in policy is the single `TradingStrategy.maxPyramidTiers` knob: `1` = one position
per symbol; `>1` allows follow-ups when the existing position is green and its broker SL is
actually set at breakeven-or-better (mirrored for SHORT). See #721 and
`docs/diagrams/manual-signal-trade-flow.md` (Google Drive) for the full decision flow.

Execution feasibility is assessed **twice with the same library** (#723): once at signal
GENERATION so the card shows execution blockers with change-hints before any click, and again
at EXECUTION as the authoritative re-check. Every blocker carries a hint of what the user could
change to reach a different outcome — no dead-end messages.

## 7. Issue trail

- #714 (queues / single scoring line) · #712 (protocol subscriptions) · #674 (redefinition epic) ·
  #624 (terminology) · #574 (execution semantics) · #695 (FX go-live gate) · #721 (duplicate-position
  policy) · #720 (manual-trade defaults) · #719 (broker symbol availability).
