## Pre-close checklist — #1091 (verification close: the fix landed with the issue; this is the live re-test)

**The fix was already in the tree** (`position-sync.service.ts:1373`):
```ts
closedAt: closedAt ?? trade.closedAt ?? new Date(),
```
…and the recovery was already done and measured in the issue itself (**50/50 damaged rows restored, 0 left in the run window**).

### What this close adds — the live re-test (not previously run)

The defect's shape: a REPAIR pass over already-closed rows re-stamped `closedAt` with the run time when no deal could be re-read. The test that actually exercises it:

1. Snapshot every `provider='mt5' AND pnlInvalid=1` row's `closedAt` (**130 rows**).
2. Run the same pass that caused the damage: `POST /api/providers/repair-pnl?provider=mt5&limit=250` → `{"examined":130,"repaired":17,"notRepairable":113}`.
3. Snapshot again and compare **per row id**.

**Result: `compared=130, moved=0`** — every still-invalid row kept its `closedAt` byte-for-byte. The defect is not merely fixed in source; the exact reproduction no longer moves a single date.

### Gates

- `position-sync-ticketed-reap.spec.ts` — **13/13 green**, including the pinned case *"the repair pass KEEPS the row's existing closedAt when no deal resolves (#1089)"*.
- Canary (recorded in the issue, both directions): mutation to the old line → **1 failed**; restored → 9 passed; byte-for-byte restore verified.
- Live: the pass ran on the deployed 0.124.0 build.

### ⚠️ Still not established (from the issue, unchanged)

Whether runs BEFORE 2026-10-08 also stamped run times — no pre-run snapshot exists for those, so the historic extent cannot be reconstructed. The fix prevents recurrence; the recovery covered everything the 2026-10-08 run damaged.
