---
date: 2026-09-10
area: scoring
type: bugfix
---

## What Changed

**#733 (MST-007) directive outcome learning loop** — the loop was wired but produced
nothing. Documented requirements 1–3 were already implemented (15-minute cron,
independent per-horizon maturity, accuracy read-only), yet the live table held
**40,120 rows with zero horizon prices filled** and 3,000 rows finalised empty.

Three defects, all inside `outcome-tracker.service.ts`:

1. **`timeframe` label mismatch** — 35,472 rows (88%) carried MT5-style `M15` while
   `MarketBar.timeframe` stores `15m`. The lookup filters by equality, so those rows
   could never mature. New exported `canonicalTimeframe()` maps `M15/H1/D1` →
   `15m/1h/1d`, applied **on write** and **at lookup** — the latter recovers the
   historical backlog rather than letting the grace path discard it.
2. **Sweep starvation** — the sweep took the 500 oldest pending rows, so the unfillable
   backlog blocked the 4,648 rows with valid labels behind it (a 2-day-old AUDUSD 5m row
   still had NULL horizons despite bars existing inside its window). Batch 500 → 1000,
   plus a saturation warning that reports the true pending count.
3. **Silent failure** — `getPriceAt()`'s `catch { return null }` made a 100%-failure
   lookup rate look identical to "no data yet". Now logged at debug.

## Files Changed

- nest/src/modules/scoring/outcome-tracker.service.ts — `canonicalTimeframe()`, canonical write + lookup, `MATURATION_BATCH`, saturation warning, logged lookup errors
- nest/src/modules/scoring/outcome-tracker.service.spec.ts — NEW (7 cases)
- docs/directive-restructure-reconciliation.md — §4 correction block

## Why (theory)

**"Wired" is not "working".** A scheduler entry proves intent, not output. The check that
matters for a measurement loop is whether the columns it exists to fill are actually
non-null — the cron here had been firing for days while 100% of lookups returned NULL,
and the only visible signal was a grace-finalisation count.

**Labels are an interface.** Two components agreed on "15 minutes" but disagreed on how
to spell it (`M15` vs `15m`), and the join between them was an exact-equality filter, so
the mismatch silently degraded every downstream write to NULL. Where a string crosses a
boundary, canonicalise it at the boundary (and again at read, so historical rows heal).

**A queue ordered oldest-first must not be blocked by unprocessable work.** Head-of-line
blocking on rows that can never complete starves every valid row behind them; finalising
unsolvable items and reporting saturation are what keep the queue honest.

**And a narrow `catch` that returns a benign default hides bugs precisely where they are
most expensive** — a data-producing loop.

## Capability Map Entry

- **name:** Directive outcome learning loop (MST-007)
- **persistence:** `directiveoutcome` table (per-horizon prices, `directionCorrect`)
- **uiSurfaces:** `GET /api/scoring/accuracy` (read-only)
- **pipeline:** scoring → outcomes → (future) directive performance
- **completion:** code complete + unit-verified; live maturation pending the next natural restart

## QA Test Entry

- **area:** Scoring / Outcomes
- **name:** Outcome maturation resolves canonical timeframes
- **procedure:** `npm --prefix nest test -- --testPathPatterns=outcome-tracker`
- **expected:** 7 tests pass — legacy `M15` rows look up `15m` bars and fill all four horizons; only due horizons fill; grace finalises; saturation warns

## Architecture Framework Entry

- **section:** scoring / outcomes
- **summary:** `canonicalTimeframe()` is the single mapping between MT5-style timeframe labels and `MarketBar` labels, used on both write and read of directive outcomes. The maturation sweep batches 1,000 oldest-first rows, fills each horizon only after its own due time, finalises past a 25h grace window, and warns when the batch saturates.
