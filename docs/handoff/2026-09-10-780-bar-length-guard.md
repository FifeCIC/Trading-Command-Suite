---
date: 2026-09-10
area: scoring
type: bugfix
---

## What Changed

Closed the market-data half of `#780` (a bar dated beyond its own bar length was persisted,
then could never be overwritten, pinning a symbol's newest-bar time forever) and made
`INV-NO-FUTURE-ROWS` test the real contract — a bar is stamped by its OPEN time, so the
forming bar is legitimately ahead of the clock and the old bare `> now` check failed on
healthy data.

## Files Changed

- `nest/src/common/utils/timeframe.ts` — added `barLengthMs()` and
  `isBarBeyondItsOwnLength()`; the ONE definition of "impossible bar", used by both the
  writer and the probe (ADR-014).
- `nest/src/modules/market-data/bar-refresh.service.ts` — skip + warn on an over-length bar;
  added `1m` to `TF_STALE_MS`; reports skipped count in the completion log.
- `nest/src/common/utils/bar-length-guard.spec.ts` — NEW, 12 tests pinning the boundary in
  both directions, including the discriminator (one timestamp impossible for `1m`, legitimate
  for `15m`).
- `nest/scripts/contract-probe.cjs` — `INV-NO-FUTURE-ROWS` is now timeframe-aware.
- `nest/scripts/analyse-unreachable-capacity.cjs` — applies direction-mode exclusions from the
  live API and reports `exclMode` so the denominator is auditable against `configuredSignalMax`.
- `nest/scripts/probe-bar-timestamp-path.cjs` — NEW, read-only bridge-vs-stored timestamp diff.
- `nest/scripts/probe-timezone-roundtrip.cjs` — NEW, read-only Prisma/`datetime` drift check.
- `nest/prune-future-orphans-780.sql` — one-off prune with backup table.

## Capability Map Entry

- **name:** Bar timestamps & freshness integrity
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Market Data
- **name:** No bar is dated beyond its own bar length
- **procedure:** Run `node nest/scripts/contract-probe.cjs`. It ignores legitimate forming
  bars (a 15m bar may lead by up to 15 minutes) and reports only rows beyond their own length.
- **expected:** `PASS [INV-NO-FUTURE-ROWS]` with `orphans=0`. A non-zero count means rows
  exist that no future refresh can overwrite — they must be pruned.

## Architecture Framework Entry

- **section:** data
- **summary:** Bar timestamps are OPEN-time and timezone-naive (`datetime(3)`). A forming bar
  is legitimately ahead of wall clock by up to one bar length, so "in the future" is not a
  fault; "beyond its own bar length" is. Enforced on write
  (`bar-refresh.service.ts` via `common/utils/timeframe.ts`) and on read
  (`contract-probe.cjs` INV-NO-FUTURE-ROWS).

---

## Theory — the bit worth keeping

### A bar's timestamp is its OPEN time

This is the fact that made the alarm look like a failure when it was normal operation:

```
forming 15m bar opens 19:15 while the clock reads 19:02  ->  +13 min : CORRECT
forming  1m bar opens 19:02 while the clock reads 19:01  ->  +1  min : CORRECT
```

So `timestamp > now` is **not** a defect test. The original `INV-NO-FUTURE-ROWS` used it and
reported 41 marketbar + 136 directiveoutcome rows as violations while every one was a forming
bar or an outcome derived from one. It still failed *after* 226 genuine orphans had been
pruned — which is what exposed the guard as the second bug.

**The right question is "beyond its OWN bar length?".** That is the only test that
distinguishes a normal forming bar from an impossible row, and it is why the same timestamp can
be legitimate for `15m` and impossible for `1m` (pinned by a test).

### Why an impossible row is worse than a wrong one

The refresh upserts only the timestamps it just fetched (`ON DUPLICATE KEY UPDATE`), and a
bridge never serves a future bar. So an over-length row is **unoverwritable**: it stays
`MAX(timestamp)` for that symbol indefinitely, making the feed look permanently future-dated
and defeating every staleness check downstream.

Measured: **226 rows, 17 of 183 symbols pinned**, written during a ~10-minute window when the
bridges were **not listening at all** (down 19:34–19:45, up 19:48/19:50). The signature was
unmistakable — one identical timestamp across `1m`, `5m` **and** `15m` for a symbol, which no
real bar sequence produces.

It also propagated: `directiveoutcome.predictedAt` copies the evaluated bar's open time
(`signal-envelope.service.ts` ~L391), so one bad bar produced bad outcome rows. Those resolved
themselves once the bars were pruned — it was never an independent bug.

### The generalisable rule

**When a write can never be corrected, guard the write, not the read.** Pruning is cleanup;
the guard is the fix. That is why the check lives in `bar-refresh.service.ts` as well as the
probe.

Corollary: **a dropped bar must warn.** Silently skipping an impossible bar would hide a real
clock-skew regression (`#750`), so the skip is logged and counted in the completion line.

## Still open

- **`#761`** — median **41.5%** of configured capacity never reaches the numerator (outcome-derived,
  7 days). Gate and bands proposed with evidence; awaiting the user's decision on the gate value.
- **`UK100`** returns a **four-month-old** feed (`05/15/2026`) on broker 2, while the refresh
  actively fetches it. Worth its own check; `isStaleSet` correctly rejects it but the fallback's
  behaviour then needs review.
- `directive.nature` reads `predictive` for the RSI pair rather than `bullish`/`bearish`, so
  polarity cannot be reproduced from the DB column — it lives in `directionBias` on the
  implementation class. This is the drift `ProtocolHealthService` warns about and it means
  **SQL cannot reproduce the scorer's denominator**; read `configuredSignalMax` from live
  readings instead.
