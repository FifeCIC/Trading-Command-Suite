## Pre-Close Verification

- [x] **Raw bridge candle timestamp is unambiguous (ISO-8601 `Z`)** — `mt5_bridge_v2.py` `utc_iso()` emits `datetime.fromtimestamp(..., tz=timezone.utc).isoformat()…Z`. Verified live: `GET /candles?symbol=XAUUSD&timeframe=1h` returns `"timestamp": "2026-08-14T20:00:00Z"` (was a naive `2026-08-14T19:00:00` before).
- [x] **`gold-session-profile` reports the correct session for the actual UTC hour** — `mt5.adapter.ts` `new Date(b.timestamp)` now parses a `Z` string as true UTC, and the directive's `timestamp.getUTCHours()` (gold-session-profile.directive.ts) yields the correct hour. Verified end-to-end: gated score for XAUUSD returns "Asian session" for the latest 1d bar at `00:00Z` — matches the session table (Asian = 0–8 UTC). `marketStatus.asOf` is now a correct UTC instant.

## Notes

- The bridge source fix was already in place (committed `b78d383 Dual Score System`); the running bridge was a stale instance. Restarted both bridge instances (MetaQuotes-Demo :5000, PepperstoneUK-Demo :5001) from the fixed source.
- No directive-layer patches were made (correct per the issue — the bug was purely at the data layer).
