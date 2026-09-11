# Handoff — ⚠️ SUPERSEDED: the "feed gap" was a bridge restart, not a defect

**Date:** 2026-09-11
**Issue:** **#795 — CLOSED as NOT-A-BUG**
**Status:** ⚠️ **This handoff's original conclusion was WRONG.** Corrected below; kept because the
mistake is more instructive than the non-finding.

---

## ❌ Correction — read this, not the original body

**The owner challenged the severity, and he was right.** I filed #795 as `priority-high` from the
**pattern** (29 symbols, simultaneous) without checking the **cheapest available evidence**: the
bridge logs.

| Time | Event | Evidence |
|---|---|---|
| `20:52:03` | **Both bridges restarted** | last line of `bridge-broker2.log` and `bridge-broker3.log`: `MT5 Bridge v2 listening on http://127.0.0.1:5000/5001` |
| `20:55 → 21:10` | the bar gap | bars stop 3 minutes after the restart |
| `21:25` | feed resumed, **30/30 symbols** | live query |

**The restart was caused by development activity** — I ran `build:api` repeatedly during verification,
and the launcher cycles the bridges. **A bar gap immediately after a bridge restart is expected.**

### It self-heals — and it was healing while I investigated

I mis-read this as *"a partial backfill that failed to converge"*. It is just the refresh loop catching
up cycle by cycle:

| Observation | symbols with a `21:00` 5m bar |
|---|---|
| first look | **0** |
| ~10 min later | **5** |
| ~20 min later | **10** |

**Why it self-heals, in arithmetic:** `BarRefreshService` re-fetches **by count**
(`BAR_REFRESH_LIVE_LIMIT=200`). At `5m`, 200 bars = **16.7 hours** of history — far more than any
plausible development gap, so a normal re-fetch reaches back **past** the hole and fills it.

### The one real detail: per-broker catch-up rate

| Broker | Symbols | Refilled? |
|---|---|---|
| broker 2 — MetaQuotes | `EURUSD`, `AUDUSD`, `USDJPY`, `GBPUSD` | **4 / 4 ✅** |
| broker 3 — Pepperstone | `SPY`, `QQQ`, `XAUUSD`, `UK100`, `GER40` | **0 / 5** at the same moment |

Not data loss — broker 3 resumed more slowly. (`BTCUSD`/`DOGEUSD` hold no `5m` bars at all;
binance-sourced, covered by `INV-CADENCE-COVERAGE`.)

---

## Answering the owner's actual question: is a refill check worth building?

**No — and the reason is that the capability already exists.**

Every adapter implements `getCandles(symbol, timeframe, limit)` — the same call the refresh loop uses.
A re-fetch fills a gap **with no new code**, which the self-healing above demonstrates directly.

A gap only becomes **unrecoverable** if it **exceeds the fetch window** (e.g. > 16.7h at `5m`), or if a
symbol stops being refreshed entirely. That is the only case worth acting on.

⚠️ A dedicated *refiller* would add a **second data-write path** beside `BarRefreshService` and
`importBars()` — against ADR-014 (one implementation per concept) — and would need the
`INV-BAR-ALIGNED` alignment rules re-applied. **Not justified.**

### What IS worth doing (small, and it prevents re-investigation)

1. **`INV-BAR-ORDER` now distinguishes the two cases** — the actual fix made:
   - bars **exist** between `asOf` and newest → **FAIL** (a real scoring defect, #751)
   - **no bars exist** in that window → **PASS with a note** (a data gap, expected)
   Proven in both directions.
2. **Bridge restarts should be a first-class event** so a gap near a restart is *explained* rather than
   needing raw-log archaeology.
3. **Age the finding:** a gap older than the fetch window is unrecoverable and actionable; inside it, it
   self-heals. That distinction removes most false urgency.

---

## ⚠️ The mistake worth recording — the FOURTH of its kind that day

| # | Wrong conclusion | What caught it |
|---|---|---|
| 1 | Guard rule fired **68×** on healthy code | running it on the real tree |
| 2 | Diff reported **419 phantom** rows | running it on the real tree |
| 3 | Two "open decisions" that **did not exist** | re-checking the actual data |
| 4 | **`priority-high` on a non-bug** | the owner's challenge, then one bridge-log read |

**Common cause: concluding from the SHAPE of the output instead of from the underlying fact.** The
pattern was real every time; the inference was not.

**The habit that would have caught all four:** *"what is the cheapest piece of evidence that could
falsify this?"* For #795 that was `bridge-broker2.log` — one command.

⚠️ And the cost is not just wasted time: **an over-filed non-bug teaches the owner to distrust the
reporting.** That is the same failure as a guard that fires on correct code — worse than no signal,
because it looks like coverage.

---

## Related

- **#795** — closed NOT-A-BUG
- **#751** — the *real* defect this check exists to catch (bars exist, arena did not see them)
- `docs/SETTLED-DECISIONS.md` **row 11** — "a bar gap after a bridge restart is expected and self-heals"

