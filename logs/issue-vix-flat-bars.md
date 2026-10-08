# VIX 1m bars are 73% a repeated constant — 10,947 of 15,041 flat, with only 124 distinct closes

**Found 2026-10-07** while verifying that **#1068** (the fabricating bar-refresh block) was fixed by re-measuring
its signature on the live database. **#1068's block is gone — this is a SECOND source, and it is still writing today.**

⚠️ **This is a different defect from #1068 and from #1049.** #1068 was `BarRefreshService.doRefresh()`
synthesising a **5m** bar from `(bid+ask)/2`; it is deleted, with a register row and a canaried guard
(`bar-refresh-no-synthetic.spec.ts`). Nothing below is that block.

---

## The measurement

```sql
SELECT s.ticker, b.timeframe, COUNT(*) AS total,
       SUM(b.open=b.high AND b.high=b.low AND b.low=b.close) AS flat,
       COUNT(DISTINCT b.close) AS distinct_closes
FROM marketbar b JOIN symbol s ON s.id=b.symbolId
WHERE b.timeframe='1m' GROUP BY s.ticker, b.timeframe;
```

| ticker | 1m bars | flat (`o=h=l=c`) | flat % | **distinct closes** |
|---|---|---|---|---|
| **VIX** | **15,041** | **10,947** | **73%** | **124** |
| FRA40 | 14,233 | 51 | 0.4% | 3,027 |
| GER40 | 14,719 | 1 | 0.0% | 5,369 |
| US30 | 6,428 | 1 | 0.0% | 3,792 |
| XAUUSD | 16,954 | 1 | 0.0% | 11,047 |
| US500 | 16,452 | 0 | 0.0% | 2,357 |

The last column is the one that settles it. **Every other instrument measured has thousands of distinct
closes; VIX has 124 across 15,041 bars.** A repeat count alone could be a quiet market — a clock and a
price constant are not.

Every flat row also carries `volume <= 1`, and the longest run is **99 consecutive minutes at exactly
`16.25`** (17:11 → 20:25 on 2026-10-06), then 78 at `16.24`, 76 at `16.44`, 60 at `16.45`.

## It is still happening

Flat 1m rows by the day they were **written** (`DATE(importedAt)`):

| written | flat 1m rows |
|---|---|
| 2026-10-05 | 362 |
| 2026-10-06 | 827 |
| **2026-10-07** | **274** |

So this is not a backlog of old rows. The writer is live.

## What I have NOT established

⚠️ **I have not identified the writer, and I am deliberately not naming one.** Known about the rows:
`provider='mt5'`, `recordingSessionId NULL`, and they appear at **1m, 5m, 15m, 1h, 4h and 1d** — so it
is not the deleted block (5m only). The candidates are the bridge's `/candles` for VIX, a provider
adapter, or the daily/period importer. **Tracing it is the first task on this issue**, and the fix
depends on the answer — a feed that genuinely serves one value needs a *refusal*, not a repair.

⚠️ **Also unexplained, and it is a second, independent signal:** VIX has **15,041** 1m bars. A VIX
session is ~390 minutes (09:30–16:00 ET), so ~13 weekdays is roughly **5,000** — VIX holds about **3×**
that. Bars appear to exist for minutes the instrument does not trade. This is consistent with the
constant-value rows but is **not proof of the same cause**, and is recorded so the two are not conflated.

## Why it matters — it is a money path input

- VIX is scored (`vix-spike-v1`, `vix-short-v1`) and is the app's **only SELL source** (#770).
- Scoring reads these bars. A price that has not moved for 99 minutes is not a price, and a
  volatility protocol reading a frozen VIX is reading a constant.
- **#972 already measures the symptom from the other end**: *"Valid signals refused because a quote is
  missing — VIX 23/day, GER40 15/day."* That is a separate fault, but both land on VIX, and neither
  should be fixed without knowing which one is producing the numbers being read.

## First task

Trace the writer for VIX 1m rows — which code path inserts `provider='mt5'` bars for VIX — and only then
decide between **refusing** the feed and **repairing** the import. Do not narrow the detector to hide
the rows: the 124-distinct-closes figure is the evidence, and the control table above is what makes it
a finding rather than an opinion.

---

**Related:** #1068 (fixed — the 5m `(bid+ask)/2` synthesis) · #1049 (Friday daily bar repeats Thursday) · #972 (VIX quotes missing) · #770 (VIX is the only SELL source)
