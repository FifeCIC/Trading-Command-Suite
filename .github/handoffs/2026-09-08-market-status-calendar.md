---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Fixed #732: US equities (SPY/QQQ/VIX) showed "Market closed" on the scoring ladder during
US market hours when the data feed was merely stale. Root cause: `computeMarketStatus` (bar
freshness) cannot distinguish "market closed" from "data stale", so a lagging feed was
labelled "Market closed" even while the US market was open.

Fix: made the market status calendar-aware. `ProtocolGatingService` now:
- for 24h markets (forex/metals/crypto) keeps bar freshness as the open/closed signal;
- for non-24h symbols (US equities/indices) uses `MarketCalendarService` — `open` now means
  "safe to trade" (calendar open AND data fresh), and a new `stale` flag reports "market open
  but data stale" so the UI can label it "Stale" instead of "Market closed".
The canonical `buildScoreDisplay` and `LadderPage`/`SymbolsLadderPage` now render "Stale" vs
"Market closed" from that flag. Execution safety is unchanged (`open === false` still blocks).

Also reverted a #736 regression that had passed `bars[last].timestamp` as `computeMarketStatus`'s
reference time (stale feeds would have appeared "open").

## Files Changed

- nest/src/modules/directives/directives.service.ts — exported `is24HourMarket`
- nest/src/modules/scoring/protocol-gating.service.ts — calendar-aware market status + `stale` flag
- nest/src/modules/scoring/scoring.module.ts — imports CalendarModule
- src/core/score-display.js — distinguishes STALE (stale flag) from PAUSED (closed)
- src/pages/LadderPage.jsx — renders "Stale" vs "Market closed"

## Why (theory)

"Market closed" and "data stale" are different facts and must not share one boolean. A US
equity's tradability is governed by the exchange calendar (open/closed) AND by feed freshness
(stale/current). Collapsing both into `open` is what produced the mislabel: a stale feed at
13:00 ET looked identical to a weekend. Splitting them (`open` = calendar-and-fresh, `stale` =
calendar-open-but-fresh) lets the UI and the execution gate each consult the fact they need.

## Capability Map Entry

- **name:** Calendar-aware market status (closed vs stale)
- **persistence:** ephemeral
- **uiSurfaces:** 2
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Ladder
- **name:** US equities show "Stale" (not "Market closed") when open-but-stale
- **procedure:** during US market hours, inspect `/scoring/live-ordering-stack` for SPY/QQQ/VIX
- **expected:** "Stale" badge when the feed lags; "Market closed" only on weekend/holiday/after-hours

## Architecture Framework Entry

- **section:** scoring
- **summary:** ProtocolGatingService now determines market status from the US exchange calendar (for non-24h symbols) plus bar freshness, exposing `open` (safe-to-trade) and `stale` (open-but-stale) separately; the ladder UI distinguishes "Stale" from "Market closed". Files: protocol-gating.service.ts, score-display.js, LadderPage.jsx.
