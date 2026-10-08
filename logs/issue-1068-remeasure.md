## Re-measured 2026-10-07 — this issue's own defect is FIXED; the rows still being written have a DIFFERENT cause

Verifying this issue's signature on the live database, as its own acceptance requires.

### The block is gone, and guarded

`bar-refresh.service.ts` no longer contains the synthesis — the site is now a `WHAT WAS HERE` block with a
**DECISION marker** (deleted, not gated), a register entry, and a canaried guard:

- `npx jest src/modules/market-data/bar-refresh-no-synthetic.spec.ts` → **9 passed**.
- The decision's own record: *"the synthetic row fails 3 of its 6 cases"*, and the first canary attempt was
  itself recorded as INERT — *"it inlined literals the `$executeRaw` mock never records"*.

### The signature, by the day it was WRITTEN

```sql
SELECT DATE(importedAt), COUNT(*) FROM marketbar
WHERE open=high AND high=low AND low=close AND volume<=1 GROUP BY 1;
```

| written | flat rows | note |
|---|---|---|
| 2026-10-02 | 1,111 | before the removal |
| 2026-10-03 | **1** | the removal lands |
| 2026-10-04 → 10-07 | 247 / 398 / 946 / 289 | ⚠️ **still writing** |

⚠️ **Those later rows are NOT this issue's writer.** They span **1m, 5m, 15m, 1h, 4h and 1d** — the
deleted block wrote **5m only** — and they are `provider='mt5'`.

### The control that separates "quiet market" from "fabrication"

| ticker | 1m bars | flat | **distinct closes** |
|---|---|---|---|
| **VIX** | 15,041 | **10,947 (73%)** | **124** |
| FRA40 | 14,233 | 51 (0.4%) | 3,027 |
| XAUUSD | 16,954 | 1 | 11,047 |
| US500 | 16,452 | 0 | 2,357 |

FX and crypto are **0–14 flat in ~1,123 bars** — genuinely quiet minutes, i.e. real data. **VIX is the
outlier: 73% flat and only 124 distinct closes**, longest run **99 consecutive minutes at exactly 16.25**.

**Filed separately as #1084**, because it is a different writer, a different mechanism and a different fix.
It is not being folded in here: this issue's own defect is the 5m `(bid+ask)/2` synthesis, and that is done.

### Not done by this comment

⚠️ **This issue stays OPEN.** I have not re-measured the *"55,518 rows across 67 symbols before the close"*
figure quoted in the body's "Not done" section, and the control above suggests part of that population is
ordinary quiet bars rather than fabrication — so the number needs re-deriving before it is quoted again.
Nor have I decided the fate of the historic rows.
