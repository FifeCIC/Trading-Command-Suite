# Position stop chart — the StopGuardian made visible, per position

**Owner request, 2026-10-08 (verbatim):**

> "I'm considering a panel with a chart to display all the SL, trailing, TP and even the history of adjustments… This might be how I start determining the parameters. Right now the guardian trailing stop loss doesn't seem to be strict enough or close the gap soon enough."

> "Ideally when I view a historic/closed position I can see the chart based on the available data still."

## The problem

The StopGuardian (the service that trails a position's stop after entry, from a 4-directive consensus — supertrend, chandelier-exit, atr-trailing-stop, wick-filter) is invisible as a *shape*. Its moves exist as rows — `stop_adjustment` holds **19 rows** for US30 ticket 93923651 on 2026-10-08 alone (SL 50,967.3 → 51,111.15 between 18:28:26Z and 20:09:09Z) — and aggregate statistics exist on the StopGuardian Stats page (#988 — how often it moves, how far, whether the #927 floor held). What exists **nowhere**: a per-position picture of price vs entry vs the SL staircase vs TP vs the peak. That picture is how "is the trail strict enough / does it close the gap soon enough" gets judged.

## What exists (this is rendering work, not new capture)

| Data | Source | Note |
|---|---|---|
| Every stop move | `stop_adjustment` rows | `oldSl`→`newSl`, `oldTp`→`newTp`, `adjustedAt`, and a `reason` string carrying the full evidence |
| History API | `GET /api/trading/stop-adjustments?symbol=&tradeTicket=&limit=` | ⚠️ caps at **100 rows** (`Math.min(..., 100)`); a long hold can exceed — needs a full-history read |
| Stored bars | `marketbar` table + canonical loader `MarketDataService.getBars(symbolId, timeframe, count)` | 1m/5m/15m/1h/4h; US30 has 1,024×1m bars on 2026-10-08. ⚠️ newest-**N**, not a date range — the chart needs `[openedAt, closedAt]` |
| Bridge candles | `GET /api/market-data/candles` | ⚠️ **proxies the MT5 bridge** ("Proxy MT5 bridge candles for charting") — fine for the live tail, history-limited; NOT the source for closed positions |
| Closed position record | `trade` row | entryPrice, exitPrice, sl, tp, closeReason, pnl, openedAt/closedAt + `peakPrice`/`peakProfitPct` (copied at close — #998 durable peak tracking) |
| Live position record | `position` row | currentPrice + `peakPrice`/`peakProfitPct`, refreshed per tick |
| Live SL/TP ground truth | broker bridge `/positions` (per `brokerId` — #1030 routing) | ⚠️ the `position` table has **no sl/tp columns** — live SL/TP must come from the broker (fallback: latest `stop_adjustment.newSl`) |
| Guardian declines | **system log only** | NOT stored — see Non-goals |

`reason` format (real row from the US30 fixture):

```
Consensus 55 | ATR=59.85000 | dist=0.400% | slPct=0.4 | Wick=50
```

Decline events (the raises it *wanted* to make and was gated out of) — log line from the same position:

```
[2026-10-08T20:10:09.977Z] DECLINED US30 broker=3 ticket=93923651 side=BUY outcome=below-threshold consensus=0 sl=51111.1 rec=51133.5484
```

Closest existing surfaces — there is **no single-position view today**: Positions Monitor (live cards, already deep-links by ticket), Position Lifecycle (Lab page, flat text list of adjustments), StopGuardian Stats #988 (aggregate only).

## Deliverable

**One reusable chart component** (`PositionStopChart`) + **one single-position view** — the first real per-position surface, working for **live AND closed** positions.

### Chart contents (v1)

- price series from stored bars; clipped `openedAt → closedAt` (closed) or `→ now` (live)
- entry line; **SL staircase** (first `oldSl` at `openedAt`, one step per `newSl` at its `adjustedAt`, final value extended); TP line (+ any TP changes)
- **peak marker** (`position.peakPrice` live / `trade.peakPrice` closed) and a **profit-lock threshold line** (entry ± the bot's declared `slPct`) — labelled as the *declared floor*, because the live band is `max(3×ATR(5m), slPct)` (#927's floor) and only moves when consensus ≥55
- one marker per adjustment; tooltip = time, old→new, full `reason` string
- live: current price + current SL/TP from the broker; closed: exit marker + `closeReason`
- worked example / QA fixture: **US30 ticket 93923651** (spot-check steps in Acceptance criteria)

### Placement (lasting — not a Lab throwaway)

- New detail route (e.g. `/trading/position/:ticket`; detail pages carry no sidebar entry — same shape as `/trading/strategy/:strategyId`)
- Reached from: Positions Monitor cards (live) and Position Lifecycle rows (open + closed)
- Component standalone + data-driven so the #1037 position-management interface can mount it later without a rewrite
- Registration per the `create-new-page` skill; theme tokens per `ui-standards`; lines distinguishable **without colour** (dash styles + labels) per `accessibility-policy`

## Non-goals (deliberately excluded to keep this deliverable)

- **No adjustment→P&L correlation.** #988's page states the rule: comparing an intervention to the outcome needs an A/B copy (`maths-change-requires-ab.instructions.md`), not a chart. This chart shows mechanics.
- **No parameter changes** — choosing new numbers (band, consensus threshold) stays an A/B change.
- **Declines overlay** — needs a capture (same shape as `sim_tsl_event`); separate follow-up.
- **Bot-page / strategy-page geometry panels** (a settings-based example chart) — sibling follow-up, separate issue.

## Acceptance criteria

- [ ] US30 93923651 renders a 19-step staircase matching `stop_adjustment` row-for-row; spot-check 3 steps: `50,967.3→50,968.3484 @18:28:26.686Z` · `51,026.5→51,041.1484 @19:23:56.243Z` · `51,096.5→51,111.1484 @20:09:09.677Z`
- [ ] A **closed** position with adjustments renders with clipped range, exit marker and `closeReason`
- [ ] **FRA40** (zero `stop_adjustment` rows ever — finding #1056) renders an explicit "no adjustments recorded" state, never a blank chart
- [ ] A failed read renders the failure through the notice registry, never an empty chart
- [ ] Live SL/TP comes from the broker for open positions (not from the DB row, which has no sl/tp)
- [ ] Full adjustment history regardless of count (the 100-row cap does not truncate silently)
- [ ] One component, both mounts (Positions Monitor + Position Lifecycle)

## Related (named so each is readable without the parent doc)

- #988 — StopGuardian Stats page (aggregate; this issue is its per-position sibling)
- #1037 — position-management interface, one screen for every open position (future home for the live list)
- #998 — durable peak tracking (`peakPrice`/`peakProfitPct`) · #978 — reconstruct-the-peak-from-bars follow-up
- #927 — the declared-distance floor that prevents over-tight trailing (the "band" the chart draws)
- #1066 — time-decaying trail distance (future behaviour this chart will measure)
- #579 — chart-library evaluation epic (reuse the library already in use; do not add a second)
- #1056 — FRA40 zero-adjustments finding (used as the empty-state test above)
