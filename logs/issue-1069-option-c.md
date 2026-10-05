## Option C — implemented, not yet deployed

The owner chose **C** (2026-10-05). Both the importer read and the change are done.

### What was measured first

| question | answer |
|---|---|
| What does the T212 importer write? | `quantity`, `avgPrice`, `currentPrice`, `pnl`, `provider`, `accountId` — **never `side`** |
| Which endpoint? | `live.trading212.com/api/v0/equity/portfolio` — **equity holdings** |
| Is it the only T212 position writer? | **Yes.** No other file creates a `position` row with `provider: 'trading212'` |
| Can a holding be short? | **All 18 rows had a positive quantity** (min 0.61, max 66.05, **zero negatives**, zero zeroes) |

⚠️ The row count moved from 19 to 18 between my two measurements — another sync. The conclusion does not depend on the exact count.

### The change

`sideFromQuantity(quantity)` — exported, so it is unit-testable:

```
qty > 0            → 'buy'
qty < 0            → 'sell'
0 or not a number  → null   ← the column is NOT written
```

**Derived from the sign, not hardcoded to `'buy'`.** "All 18 rows are long today" is an *observation*, and hardcoding it is an assumption that has to survive the day the API reports otherwise. The `null` case follows register row 60 — *"NULL ≠ 0"* — because a holding with no size has no direction, and inventing one is the defect this issue is about.

The side is also returned in the import payload, so the write is visible rather than silent.

### Verification

| Gate | Result |
|---|---|
| `side-from-quantity.spec.ts` | **6 / 6** |
| **Canary** | replaced the body with `qty < 0 ? 'sell' : 'buy'` → **exactly 2 of 6 fail**, on the `null` cases. Restored, re-run green |
| `tsc --noEmit` | **0** |
| `validate-decisions` | 66 rows, 21 markers, OK |

⚠️ **Not deployed.** `build:api` failed on an unrelated gate — `validate-notices` on `src/pages/MonitoringPage.jsx`, which is another agent's in-flight work. The API is back up on the previous build, so no T212 row has been written by this change yet. The 18 rows converge on the first successful build plus a sync; the update path carries the side now, so no backfill is needed.

**No maths was touched** — which was the whole reason C was chosen.
