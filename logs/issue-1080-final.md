**Fixed + repaired — measured, canaried both ways, ledger restated (2026-10-07).**

**Root cause (code-read + live data).** The mirror of the side door the code already guarded: for the row whose ticket **IS** the position id (`152703882760`), `trade.count` by ticket returns **1 by construction** — its nine siblings carried ORDER tickets — so it took the sole-owner branch and booked the whole net **−322.67**, while the nine siblings correctly booked their 0.10 share (−32.267 each). The ledger summed **−613.07 for a −322.67 position** (×1.9). The `resolvedFromOrder` guard covered the order-ticket rows; nothing covered the position-ticket row.

**Fix.** `position-sync.service.ts` — when the position's OPENING deals comprise **more than one order**, the volume split is forced (`multiOrderPosition`), from the deal evidence itself — the one source that cannot be confused by which ticket a row happens to carry. A single-order position still books its whole net via the sole-owner branch.

**Canaries (both directions OBSERVED):**
- New test `books the SHARE for a position-ticket row of a multi-order position (#1080)` — expects −10 (0.01/0.04 of −40); **with the guard reverted it fails: `Received: -40`** — the live defect reproduced in a test, then fixed.
- Regression canary `a single-order position ticket still books the whole net` — +26; passes on both implementations by design (it protects against over-forcing).
- Suites: **45/45** (position-sync ×3 + pnl-split); `nest run typecheck` exit 0.

**Repair (guarded, reversible):**
- Backup first: `trade_repair_1080_backup` (1 row).
- `UPDATE trade SET pnl=-32.267 WHERE id='6294d0d7…' AND pnl=-322.67` → `ROW_COUNT = 1`.
- Pile re-summed: **10 rows = −322.67** (was −613.07). Ledger re-read: **271 closed · 124W / 147L · −£642.78** (earlier today: 268 / −786.27; the count moved with live closes, the repair contributed +290.40 at the pile).

**Detectors.** `validate-pnl-integrity.cjs` no longer reports the pile; `audit-trade-pnl-attribution.cjs` now states its measured blind spot (ticket-grouping cannot see order-ticket piles — grouping by RESOLVED positionId is deliberate future work). Register **row 43** and the DECISION marker at the code site updated.

### Pre-close checklist
- [x] **Fix real** — canary fails on the old code (`Received: -40`), passes on the new.
- [x] **Visible** — pile sums exactly; ledger re-stated; register + marker + audit note updated.
- [x] **Tested** — 45/45 specs, typecheck 0; the repair was verified by re-summing the pile.
- [x] **Not done** — the audit's positionId-grouping mode (stated above, deliberate; not concealed).
