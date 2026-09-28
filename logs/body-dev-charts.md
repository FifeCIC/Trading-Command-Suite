## Why this exists

Owner direction, 2026-09-28:

> *"we're also going to create more statistics/graphs/charts views in the development area to help create snapshots of what is happening in the app"*

> *"I think the symbols page should have any form of chart that uses our existing data to help see patterns and XAUUSD is a good symbol to test such new features with"*

The Development area is the **experiment sandbox** — the place to answer *"which approach is better, and how would I know?"*. Today it has no view that turns stored trading outcomes into a picture. Every question about "is this pattern real?" is therefore answered by writing one-off SQL, which is slow, unrepeatable, and leaves nothing behind for the next person.

**This issue is the home for those views.** One view per comment, so each can be built and reviewed independently.

## The three views to build first

| # | View | Answers |
|---|---|---|
| 1 | **Give-back distribution** per symbol — histogram of (peak − final) across closed trades | *"do we systematically hand profit back, and is it one symbol or all of them?"* |
| 2 | **Trade-marked price chart** — candles with entry→exit drawn, peak annotated | *"what did the bleed actually look like on this trade?"* |
| 3 | **Score overlay** — the same chart with the protocol's composite score plotted alongside | *"what was the app saying at the peak?"* |

**Start with XAUUSD** (owner's choice). It has the best data in the repo: 124 trades, and bars at 1m/5m/15m/1h/4h/1d back to 2026-07-29.

## Data sources — all of it already stored

| Need | Source |
|---|---|
| Trades | `trade` — `symbol`, `side`, `entryPrice`, `exitPrice`, `pnl`, `openedAt`, `closedAt`, `closeReason`, `abTestId` |
| Bars | `marketbar` — joined via `symbol.id` on `symbolId`, filtered by `timeframe` |
| Scores | `score` / `score_snapshot` |

⚠️ **The bar table is `marketbar`, not `market_bar`.** I lost a query to that assumption on 2026-09-28 — `market_bar` does not exist, and the error reads as "no data" if you do not read it carefully.

⚠️ **CLOCK HAZARD — must be handled by every view.** `trade.openedAt/closedAt` are **UTC**. `marketbar.timestamp` is **also UTC** (`UTC_TIMESTAMP()` advanced in step with the newest bar — verified 2026-09-28). But the **MT5 terminal display is UTC+3**. So an operator reading a chart and comparing it to their terminal sees a 3-hour disagreement. The view must state its timezone on the face of the chart, because that mismatch silently produced a wrong analysis on 2026-09-28 (a `+3h` offset was assumed and paired every trade with price action from after it closed — and returned believable averages).

## Evidence these are worth building

Measured 2026-09-28 across 21 closed XAUUSD trades (A/B excluded), peak reconstructed from 5m bars:

| Metric | Value |
|---|---|
| Avg peak unrealised | **+0.424%** |
| Avg final | **−0.116%** |
| Avg give-back | **0.540%** |
| Reached profit | **20 / 21 — 95%** |
| Peaked, then ended flat or loss | **12 / 21 — 57%** |

That took a bespoke SQL file (`logs/x6-giveback2.sql`) to produce. It should be a view.

## Acceptance criteria

1. A Development-area route renders the give-back distribution for a chosen symbol from `trade` ⋈ `marketbar`, with `n` shown on the face of the chart.
2. The chart states its timezone.
3. ⚠️ An empty result must render differently from a failed read — `[]` is information, `null` is the absence of it, an error is a third thing. Collapsing them makes every future reader draw the wrong conclusion.
4. Reuses the existing canonical chart component if one exists — a second chart implementation is the most expensive kind of technical debt.

## Related — read these first, they carry clues

- **#998** (the peak-tracked give-back measurement this view would replace) — same reconstruction method, 9 trades
- **#978 / #979** (give-back tracking Tier 1 = reconstruct the peak, Tier 2 = record it live) — this view consumes their output
- **#974** (the signal funnel page — the existing precedent for a Systems/Development view, and the note that the only chart library cannot draw a pie)
- **#922** (symbol league table) and **#920** (bot comparison view) — sibling research views, do not duplicate their layout decisions
