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
- ✅ Keep the one-scoring-line + per-bot queue model documented in `automation-loop.service.ts`.

## 7. Issue trail

- #714 (queues / single scoring line) · #712 (protocol subscriptions) · #674 (redefinition epic) ·
  #624 (terminology) · #574 (execution semantics) · #695 (FX go-live gate).
