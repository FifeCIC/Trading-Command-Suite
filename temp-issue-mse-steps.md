# Meta.Stack Explorer — review for unintegrated pipeline steps (bot layer)

Owner request on `/status/meta-stack-explorer` (Page Walkthrough):

> *"Agent should review this page for potential new steps that isn't integrated. Especially around bots."*

**Scope: a review, not a change.** The page's step list is **unchanged** by this issue — this records what
was found so the additions can be made deliberately. Every entry below is a service that **exists and
runs**; none is a suggestion of something to build.

## What the page documents today (measured)

14 steps, in order:
`prereq-symbols` · `prereq-watchlist` · `prereq-protocol` · `prereq-automation` · `market-data` ·
`protocol` · `conditions` · `directives` · `groups` · `risk-gate` · `composite` ·
`scoring-strategy` · `trading-strategy` · `outcome`.

So the BOT layer is represented (`scoring-strategy`, `trading-strategy`) — but only at the level of
"rules" and "evaluation". Everything the bot layer does **around** those two steps is absent.

## Missing — verified to exist in the codebase

| # | Step missing from the page | Where it lives | Why it matters on this page |
|---|---|---|---|
| 1 | **Signal queue** — routing, statuses, expiry | `SignalQueueService.syncQueues()`, table `strategy_signal_queue` | The page jumps from *evaluation* to *execution* with nothing between them. This is the between. It also has its own expiry sweep and freshness bound (`common/utils/signal-freshness.ts`) |
| 2 | **Subscription gate** | `strategy_protocol` | ⚠️ A bot with no subscription **silently never trades** — routing is by subscription, not by `trading_strategy.protocolId`. The page's `trading-strategy` step reads as though the bot's own config is sufficient |
| 3 | **Execution feasibility** | `preTradeReady` / `executionBlockers` on the envelope | Volume floor, broker capability, venue mismatch. This is the class that let a bot look perfectly configured while the bridge refused every order |
| 4 | **Stop management** | `StopGuardianService` (#721) | The page shows *entry* only. Post-entry stop management has ONE canonical implementation and is not on the list |
| 5 | **Time-based exits** | `PositionTimeStopService` (#773) | A second exit authority, distinct from SL/TP |
| 6 | **Duplicate guard** | `DuplicateGuardService.checkDuplicate()` | ⚠️ Documented as **direction-unaware**: a live LONG on an instrument blocks a SHORT on the same instrument, because it filters symbol+provider and does not consider direction |
| 7 | **Position cap** | `positionCapBreach()` (#852), `risk.controller` | A hard ceiling that can refuse a trade the score allowed |
| 8 | **Signal direction authority** | `common/utils/signal-direction.ts` | Which way a signal points is derived here, not from the signal class alone — the `STRONG_SELL`-routed-as-LONG class of defect lives at this boundary |
| 9 | **Exhaustion observation** | `ExhaustionObserver` | Feeds stop/exit decisions |
| 10 | **Exit path & attribution** | close-reason classification (`common/trading/close-reason.ts`), exit-data recovery | The `outcome` step covers the trade being recorded, not *why* it closed or whether the close reason is evidence-based |

## The shape of the gap

The page is a scoring pipeline with a trading tail. The bot layer is a **state machine** — queue →
subscription → feasibility → entry → stop/time/exhaustion exits → attribution — and only its first
two states appear.

⚠️ Worth noting for whoever adds these: steps 2, 6 and 8 each correspond to a **live defect class**
already recorded elsewhere in the repo (silent no-trade, direction-blind blocking, direction
mis-derivation). Documenting them on this page would put the boundary where a reader looks for it.

## Not done here

- **Adding the steps to `MetaStackExplorerPage.jsx`.** Deliberate: each step carries `fnDesc`,
  `dbTable`/`dbColumns` and links, and inserting ten at once into a page whose whole purpose is to be
  read as *the* pipeline is a content change that deserves its own review pass, not a drive-by edit.
- **Re-verifying the direction-unaware duplicate guard.** It is quoted from the service's own
  documentation comment; the behaviour was not re-measured for this review.
