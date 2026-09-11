# Trade Reconciliation: stranded rows reaped + Fault triage

**Date:** 2026-09-10
**Area:** `nest/src/modules/providers/position-sync.service.ts` (+ spec), data repair
**Impact:** Open-position count now matches the broker; four reported faults triaged

---

## 1. Stranded Trade rows — FIXED

### The defect
`position-sync.service.ts` self-heals the **`position`** table (2026-09-10 change), but
**`trade` had no equivalent reaper**. `finalizeClosedPosition()` only ran for rows still
present in `position`, so any Trade whose Position row had already been cleaned — or was
never created — stayed `status='open'` **forever, with no broker counterpart**.

Measured damage: **17 phantom USDCAD rows** (`origin='strategy'`, NULL brokerTicket,
opened 2026-07-10…07-24) against **ZERO** broker positions. They inflated every
open-position count and any exposure figure derived from `trade`.

### The fix
`reapStrandedTrades()` — closes unticketed open Trades whose symbol is absent from an
**authoritative** broker snapshot. Deliberately conservative:

- **Only** rows with `brokerTicket = null`. A ticket is proof of life; if the broker
  reports it, the row is never touched.
- Runs **after** the `authoritative` early-return, so an outage can never trigger it.
- Rows are **closed, not deleted** (`brokerComment = 'Reconciled: no broker counterpart'`),
  so the history stays auditable and any later report can see the row for what it was.

### Verified on live data
```
before:  open=21   (17 stranded)
after:   open=4    = broker's 4 positions exactly
closed:  95 -> 112   (+17 reconciled)
```
Log: `[mt5] Position sync: 4 upserted, 0 created, 0 closed, 17 stranded trade row(s) reaped`

### ⚠️ Gotcha that cost a cycle
The first version filtered by `accountId` — **`trade` has no such column** (only `position`
does). Prisma **discards an unknown filter rather than erroring**, so the query silently
returned zero rows and the reaper reported "0 reaped" while 17 stranded rows sat in the
table. Scope the `trade` query by `provider` only. Noted inline in the code.

Also fixed: `syncPositions()`'s non-authoritative early-return was missing the new `reaped`
field, which is a compile error rather than a silent bug — worth keeping strict.

---

## 2. Fault triage — three of four were not live

The four faults came from a throughput investigation. Dated evidence shows most were
**historical or already fixed**:

| Fault | Verdict | Evidence |
|---|---|---|
| `composite 0` vs 55–60 bar (×45) | **Already fixed** | `isPercentage`/`NO_DATA` guard landed 2026-09-08 (`be0b817`); **0 recurrences** since, 0 zero-pct queue rows. The incidents ran 2026-09-06 → 09-08 10:35. |
| 17 phantom open positions | **Fixed here** | See above. |
| 26 `rejected` trades (~18%) | **Historical** | Last reject **2026-07-10** — two months ago. EURUSD×13, HOOD×7, XPOA×5. |
| `Bridge unreachable` ×48 | **Historical** | Last occurrence **2026-09-08 16:43**. None since. |

**Lesson: date every fault before ranking it.** I ranked these by frequency across all
history and treated them as live. Clustering them by date showed most belonged to one
incident window (2026-09-08), which also produced the `AutoTrading disabled` errors. The
only genuinely live fault was the trading-enabled flag — fixed in
`2026-09-10-trading-enabled-persistence.md`.

**Live proof the chain now works:**
```
GBPUSD  EXECUTED  composite 71  Ticket 152610923382  2026-09-10 12:07:32
```
First observed end-to-end automated execution: score → queue → gates → broker.

---

## 3. ⚠️ OPEN — suspicious identical loss values on EURUSD

**Not fixed. This looks like a defect, not market variance.**

```
EURUSD  -9.02   ← repeated 11+ times, identical to the penny
```

Eleven separate EURUSD closed trades share the exact value `-9.02`. That is not
plausible as independent market outcomes. Combined with **all 26 rejects also being
EURUSD**, it points to a single defective write/settlement path for that symbol rather
than to strategy performance.

### Outcome asymmetry worth acting on
| Outcome | n | Total | Avg |
|---|---|---|---|
| loss | 33 | −275.68 | −8.35 |
| win | 62 | +216.12 | +3.49 |

62 wins averaging +3.49 against 33 losses averaging −8.35 means a **70% win rate is
needed to break even**; the actual rate is ~65%. So the book loses money even before the
suspect EURUSD rows are explained.

### Next step
Trace how `trade.pnl` is written for EURUSD closes — specifically whether a single
computed value is being copied across rows (a variable reused outside a loop, or a
fallback constant applied when the real exit lookup fails). `finalizeClosedPosition()`
falls back to `dbPos.currentPrice ?? null` and `dbPos.pnl ?? null` when `getDeals`
returns nothing; a shared fallback would produce exactly this identical-value pattern.
Also verify the `rejected` EURUSD rows share a root cause — same symbol, same era.
