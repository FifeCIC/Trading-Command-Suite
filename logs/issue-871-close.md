## Pre-Close Verification — final sweep (sprint #1102 item B2)

> ⚠️ This issue has no acceptance checkboxes. Fallback checklist + the observation the 2026-09-18
> comment said was MISSING ("fix shipped — but NOT observed working live").

- [x] **Code is live — services restarted.** Verified in the served build (0.123.0): `reapStrandedTrades()` no longer filters `brokerTicket: null` — it now tests **per row** (ticket the broker reports → untouched; ticketed + absent → finalised via deal history with `quantity` carried, #1014; unticketed phantom → reaped at `pnl: 0` with `pnlInvalid` set at the write, #1044). Account scope via `mayJudgeTrade()` + **#1101's** queried-accounts fix are in the same build.
- [x] **The historical instances are resolved — measured.** The three rows the issue measured as stranded on 2026-09-18 are all CLOSED: `XAUUSD 152646338241 → broker:terminal` (pnl 1.97), `GER40 89649760 → broker:unknown` (pnl 6.66), `VIX 89657501 → broker:unknown` (pnl −0.02).
- [x] **The class is empty in production — measured.** Query on 2026-10-09: **0** ticketed open trades lack a position row. 5 open trades total, all ticketed, all with live position rows (correctly untouched — a reported ticket is proof of life).
- [x] **🔬 Observed working live (the gap this issue closed on).** Planted a synthetic TICKETED orphan (clone of a real GER40 row, fresh `CANARY-871-…` ticket, no position row) — **reconciled within one sync cycle (~2 min)**: `status open → closed`, `closeReason broker:unknown`, `exitPrice null`, `pnl null`. That is the honest outcome for a ticket with no deal in broker history: reached, judged, closed, **nothing fabricated**. The row that previously stayed `open` forever no longer survives a single tick. (Canary row deleted after observation; script kept at `logs/canary-871-orphan.cjs`.)
- [x] **Build passes.** Whole providers suite: **20 suites / 154 tests green**, including `position-sync-ticketed-reap.spec.ts` (the fix's own guard).

## Notes

- The reconciler's warn line ("Finalised abandoned Trade …") was not located in the retained log
  window after the fact — the **state transition in the DB is the observation**, and it is recorded
  above with timestamps. If the line is wanted in future sweeps, capture the ring buffer live.
- #1101 (the last reachability gap — position sync scoped to accounts PRESENT, not QUERIED) is
  CLOSED, and its `getQueriedAccountIds()` lives in the deployed adapter.
