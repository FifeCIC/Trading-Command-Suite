## ⚠️ CORRECTION (same day) — the central claim in the body is WRONG

**What I wrote:** *"the marketbar retention window is declared at 60 days [and] is NOT APPLIED (oldest row measured 295 days old, so nothing prunes it)."*

**What is actually true — measured per timeframe:**

| timeframe | oldest row | age |
|---|---|---|
| `1m` | 2026-08-05 | **exactly 60 days** |
| `5m` | 2026-08-05 | 60 days |
| `15m` | 2026-08-05 | 60 days |
| `1h` | 2026-08-05 | 60 days |
| `4h` | 2026-08-05 | 60 days |
| **`1d`** | 2025-12-11 | **296 days** |

**The 60-day window IS applied**, precisely and per series. Every intraday timeframe is trimmed at exactly 60 days. Only the `1d` series reaches deeper.

### How I got it wrong, because the method matters more than the answer

I ran `SELECT MIN(timestamp) FROM marketbar` — a **global aggregate** — saw 296 days, and concluded "nothing is pruning". The per-timeframe breakdown immediately refutes it.

**A global aggregate hid a per-series rule.** I measured the *target's* total and drew an inference about its *parts*, which is the exact failure this repo's own rules name: measure the target, not your model of it.

### What actually keeps `1d` deep — and it is fragile

The bar refresh upserts **200 bars per timeframe** every cycle. For `1d` that is ~290 days of daily bars, re-fetched and re-written continuously. So the daily depth is **a side-effect of the fetch window, not a retention policy** — the prune does delete old `1d` rows, and the next refresh puts them back.

That also explains the row count I could not account for: it fell ~3,600 in minutes because **a prune cycle ran** while I was watching. Unobserved, it looked like unexplained churn.

### What still stands

- ✅ **`btc-halving-cycle` IS starved.** It declares **`'1d': 365`**, sits in the **ACTIVE** `btc-speed-v1`, and we hold **206** daily bars. Unchanged by this correction.
- ✅ **`bollinger-squeeze` declares 72 daily bars** and we hold 206, so it is satisfied *today* — but only because the refresh re-fetches deeper than the retention window. **That is luck, not design.**
- ✅ **A fixed 60-day window is the wrong SHAPE for `1d`.** This is now *more* true, not less: it works only because a fetch happens to over-supply what the prune removes. If the fetch limit ever drops below the deepest declaration, the series thins silently.
- ❌ **"Not applied" — withdrawn.**
- ❌ **The framing "raise the window to ≥365 days" — withdrawn as the primary fix.** The window is already effectively deeper than 60 for `1d` via re-fetch. The real question is whether that mechanism is *relied on deliberately* or is accidental.

### The honest replacement statement

> The `marketbar` 60-day window is enforced for intraday series and **over-ridden for `1d` by the refresh's 200-bar fetch**. The deepest declaration (`365` daily bars, in an active protocol) is **not met** — 206 held — and nothing reports that, because a short bar array is a legitimate state.

`#1070` should be re-read with this comment as the accurate version. The body above is kept unedited so the error stays visible.
