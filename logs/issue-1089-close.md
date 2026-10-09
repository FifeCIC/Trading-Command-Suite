## Pre-Close Verification — final sweep (sprint #1102 item B1)

> ⚠️ This issue has no acceptance checkboxes. Using the fallback checklist, plus the issue's own
> QA Test Entry.

- [x] **Code is live — services restarted.** `mt5.adapter.ts` `getDeals()` → `fetchAllBrokerDeals(days)` fans out across `symbolRouter.brokerIds()` → `routeForBroker(id)` (verified in source today; the DECISION marker cites register row 69). Served build **0.123.0**.
- [x] **API returns real data — measured.** Closes on the six broker-3 symbols **since the fix deployed (2026-10-08 08:25Z), queried 2026-10-09:**

  | symbol | closeReason | n | last |
  |---|---|---|---|
  | FRA40 | `user:manual` | 1 | 10-08 08:38 |
  | GER40 | `user:manual` | 1 | 10-08 08:38 |
  | US30 | `user:manual` | 1 | 10-08 22:10 |
  | VIX | `broker:sl` | 1 | 10-08 16:49 |
  | VIX | `user:manual` | 1 | 10-08 22:11 |
  | XAGUSD | `broker:sl` | 1 | 10-08 10:32 |

  **6 of 6 real reasons, 0 `broker:unknown`** — against the pre-fix baseline **48 of 48** (issue body).
- [x] **Build passes.** `mt5-adapter-multibroker.spec.ts` — **10/10 green**.
- [x] **The guard bites (canary, this sweep).** Ignoring the route (`bridgeGet('/history', undefined)` — the exact old defect shape) → **2 of 10 cases FAIL**; restored, green again, no residue in the diff.

## Residual (explicit — NOT this defect)

The 44 pre-2026-10-05 rows sit beyond the Pepperstone terminal's ~3-day deal history (measured:
`:5001 /history/deals?days=30` returns 17 deals, oldest 10-05; `:5000` returns 482, oldest 09-08 —
recorded in the issue's 2026-10-08 comment). They belong to the **#1093 recovery flow**, as already
stated. This issue's scope — the un-routed lookup — is fixed and observed.

Closing: the last single-URL deal reader in the exit path now asks every active broker, and the
ledger shows real attributions on broker 3 for the first time.
