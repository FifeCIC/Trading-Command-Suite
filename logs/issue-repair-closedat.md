## What is wrong

`repairClosedTradesWithUnknownPnl` (#1014's pass) re-finalises rows that were closed long ago. It runs them through `finalizeClosedPosition`, whose write ends with `closedAt: closedAt ?? new Date()`. When the row's closing deal cannot be re-read, `closedAt` stays null and **the RUN TIME is written over the real close date**.

## Measured 2026-10-08

One run — `POST /api/providers/repair-pnl?provider=mt5&limit=250` (examined 182, repaired 69, notRepairable 113), part of the #1089 repair — re-stamped **50 rows'** `closedAt` into the run window (`2026-10-08 08:45–08:50`). Example: a UK100 close of **2026-09-23** became **2026-10-08**; a GER40 close of **2026-09-16** likewise. Every day-bucketed view (the sprint's own baseline table) would read those trades as closing "today".

## Recovery — done, measured

| Source | Covers |
|---|---|
| `logs/backup-1089-repair-pool-*.tsv` (taken BEFORE the run, 148 rows) | rows already `pnlInvalid=1` |
| a pre-run listing of the six-symbol rows | the 36 newly flagged that day |

**50/50 damaged rows restored, 0 uncovered, 0 left in the run window** (`logs/restore-1089-closedat.ps1`). The rows the run RESOLVED kept their new deal times — that half of the write is the improvement it was designed to be.

## Fix — landed with this issue

```ts
closedAt: closedAt ?? trade.closedAt ?? new Date(),
```

The row's existing value is the middle fallback. A LIVE close has no existing value, so `new Date()` still applies exactly where it was always correct (the same three-way shape the comment above the line already uses to protect `peakPrice`).

- **Guard:** `position-sync-ticketed-reap.spec.ts` — *"⚠️ the repair pass KEEPS the row's existing closedAt when no deal resolves (#1089)"*.
- **Canary, both directions:** mutation to the old line → **1 failed** (that case) · restored → **9 passed** · byte-for-byte restore verified.

## ⚠️ Not established

Whether EARLIER runs of this pass (before 2026-10-08) also stamped run times over close dates — no pre-run snapshot exists for those runs, so the historic extent cannot be reconstructed. The fix prevents recurrence from here.
