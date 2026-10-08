## Pre-close verification — #998 ✅

### Item 1 — durable peak tracking: DONE, LIVE, canaried

- **The record IS writing.** `position` peaks updated live today: GOOGL `peakPrice` 349.69 = **+0.3731%**, US500 7830.6 (updated 19:59Z). It copies onto `trade` at close — **33 closed rows carry a peak, the first at 2026-10-02 19:33Z**. ⚠️ The 10-02 status comment (*"the RECORD is not yet writing"*) was written **three hours before** the writer landed; it is superseded by measurement, not contradicted.
- **Writer:** `position-sync.recordPeak()` — runs in the loop that **already holds a live broker price**. Its first placement (`PriceRefreshService.refreshPrices()`) was reachable only from an HTTP endpoint — measured **0 of 26 positions** had a peak, with no error; moving it, not scheduling a second fetch, was the fix (**#1065 closed**).
- **A record, not an exit action:** independent of `simTslEnabled`; an **unpriced position is skipped** (never invents/erases a peak); monotonic (a lower price never lowers it); a failure **warns and never breaks the sync**. Arithmetic canonical in `common/trading/peak.ts`; **register row 60**.
- **Guard canaried today, both directions:** commenting out the `recordPeak` call → **2 tests FAIL** (the ⚠️ CANARY specs at L464/L479); restored → **32/32 pass** (`position-sync.service.spec.ts` + `peak.spec.ts`), restore verified byte-for-byte.
- **Consequence:** "did we give back profit?" is now answerable from **the record**, not a bar reconstruction — the four give-back rows in this issue's body are the kind of finding the record now captures going forward.

### Item 2 — time-decaying trail distance: ALREADY EXTRACTED as #1066

`#1066 — Time-decaying trail distance, the behaviour half of #998` is open and holds this scope (maths change, A/B-gated per `maths-change-requires-ab`). Nothing here waits on it.

### Declared, not silent

- **Trading 212 positions (19) carry no peak** — display-only imported holdings, not app-managed positions. The peak writer covers the MT5 positions the exit system actually manages. If the give-back monitor should include T212 holdings, that is new scope — reopen or file.
- **The 3 historic UK100 rows** ("closed with no exit price, pnl 0", 09-23 → 09-29) are **quarantined**: `pnlInvalid=1`, reason *"Structural phantom — closed with no exit price and no broker counterpart (#931, #1044)"*. Declared by the system, and **none created since 09-29**.

### Fallback checklist

- [x] Code is live — peaks writing on the running API (evidence above)
- [x] The record answers the question it was built for — no longer reconstructed from bars
- [x] Guard fails without the fix — canary observed; suites green after restore
