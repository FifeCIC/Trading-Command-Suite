---
date: 2026-08-16
area: trading
type: bugfix
---

## What Changed

Resolved MT5 bridge naive timestamps (issue #625). The bridge now emits unambiguous ISO-8601 UTC (`Z`-suffixed) timestamps via `utc_iso()`, so the NestJS adapter parses them as true UTC and time-based directives (`gold-session-profile`, `session-open-effect`, etc.) compute the correct UTC hour. Restarted both bridge instances (MetaQuotes-Demo :5000, PepperstoneUK-Demo :5001) from the fixed source.

## Files Changed

- scripts/mt5-bridge/mt5_bridge_v2.py — `utc_iso()` / `utc_now_iso()` emit `Z`-suffixed UTC; all candle/quote/position timestamps use them

## Capability Map Entry

- **name:** MT5 bridge UTC timestamps
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Trading / Providers
- **name:** MT5 candles carry unambiguous UTC timestamps
- **procedure:** `curl http://localhost:5000/candles?symbol=XAUUSD&timeframe=1h&limit=3`, then score XAUUSD and check `gold-session-profile` session vs the bar's UTC hour.
- **expected:** Candle timestamps end in `Z`; the session matches the UTC hour of the latest bar.

## Architecture Framework Entry

- **section:** data
- **summary:** MT5 bridge bar timestamps are now ISO-8601 UTC with `Z` (was naive local strings). The NestJS adapter parses them as true UTC, fixing a ~3-4h session/timing offset across all time-based directives.
