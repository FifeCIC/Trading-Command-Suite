---
date: 2026-09-10
area: trading
type: bugfix
---

## What Changed

Diagnosed and fixed the **MT5 bridge server-clock skew** (#750, regression of #625).

MT5's rate/position/order/deal/calendar `time` fields are **broker SERVER-clock
epochs**, not UTC. The bridge's `utc_iso()` assumed UTC and tagged the result `Z`, so
every MT5-sourced timestamp was asserted to be UTC while actually ~3h ahead
(MetaQuotes-Demo = UTC+3). Measured: bridge 5m bars read `11:55Z` when true UTC was
`09:02Z`.

- `detect_server_utc_offset()` — derives the offset from the one pair of clocks
  readable at the same instant (fresh tick's server epoch vs the machine's true epoch),
  rounded to 15 min so tick lag cannot leak in; cached with a 30-min TTL (DST moves
  twice a year).
- `utc_iso()` now subtracts that offset. All 12 call sites are MT5-sourced, so the
  conversion stays in one place.
- Offset logged on every (re)connect and exposed on `GET /health`
  (`serverUtcOffsetSeconds` / `serverUtcOffsetHours`).

## Files Changed

- scripts/mt5-bridge/mt5_bridge_v2.py — offset probe, `utc_iso()` conversion, connect-time measurement + log, `/health` exposure

**Not deployed**: the bridge is a running process; the fix applies at the next bridge
restart (agents were asked not to force restarts — parallel agents clash over the app).

## Why (theory)

**Two clocks are not interchangeable.** "Now" from the machine and "now" from the broker
are different values whenever the broker's server is not on UTC, and MT5 exposes no
timezone field — so the offset has to be *measured*, not assumed. Saying `Z` on a server
timestamp is worse than the naive-local bug it replaced, because it looks authoritative
and hides the error from every downstream parser.

**A staleness check that can go negative is not a staleness check.** `computeMarketStatus`
computes `ageMs = now − lastRealBar`; with bars in the future that value is negative and
`ageMs > 3 × interval` can never fire, so the tradability gate silently failed open.
Timestamp-based gates need a sanity bound on the other side too (a bar dated in the
future is itself a data-integrity failure).

**Where to fix a shared clock**: at the boundary that owns the conversion (the bridge),
once, rather than compensating in each consumer. Compensation logic spread across N
consumers is how the original assumption survived a "fix" 4 weeks ago.

## Capability Map Entry

- **name:** MT5 bridge timestamp normalisation (server clock → UTC)
- **persistence:** `marketbar` + bridge payloads (all MT5-sourced timestamps)
- **uiSurfaces:** `GET /health` (bridge), market-status pills on scored pages
- **pipeline:** market data → scoring / automation
- **completion:** code complete + logic-verified; deployment + stored-data repair pending

## QA Test Entry

- **area:** Market data / timestamps
- **name:** Bridge timestamps are true UTC
- **procedure:** `GET :5000/health` → read `serverUtcOffsetHours`; then `GET :5000/candles?symbol=EURUSD&timeframe=5m&limit=1` and compare with the machine's UTC clock
- **expected:** offset reads the broker's real offset (e.g. `+3.00`); newest bar is within one bar interval of UTC now, NOT hours ahead

## Architecture Framework Entry

- **section:** market data / mt5
- **summary:** The bridge measures the broker's server-clock offset from a live tick and applies it in `utc_iso()`, so every MT5-sourced timestamp is true UTC and only the machine clock uses `utc_now_iso()`. Stored bars from before the fix remain server-stamped and need a DST-aware repair.
