## Pre-Close Verification — all five acceptance criteria, each with its observation

### 1. ✅ Source of truth decided, and the reason recorded

**Decision: a curated static table (`FX_HOLIDAYS` in `market-calendar.service.ts`), the same mechanism as `US_HOLIDAYS`.**

Why, by measurement rather than taste:

| Option | Verdict |
|---|---|
| Broker-reported per-day tradability | ❌ **Measured unavailable.** The MT5 Python binding exposes NO session/holiday API — `dir(mt5)` in the symbol family is only `symbol_info` and `symbol_info_tick` (run against the installed binding, 2026-10-08). Reading the broker's calendar would mean inventing a probe. |
| `order_check` probe ("would the terminal accept a minimal order?") | ⚠️ Recorded as a FUTURE option, not used: heavy per gate evaluation, and carries the filling-mode trap of #824. |
| Documented convention table | ✅ **Chosen** — matches the precedent mechanism, and the table's scope is deliberately narrow (below). |

Recorded in all three homes: `DECISION` marker at the table, **register row 73**, and this comment.

### 2. ✅ A weekday holiday on the FX venue reports closed — verified live

Against the **running built API** (not a unit test):

```
GET /api/calendar/market-status?exchange=FX&at=2026-12-25T12:00:00Z
→ isOpen=false  status=closed  holiday=Christmas Day  nextOpen=2026-12-27T22:00:00Z (Sun 22:00 GMT)
```

Before this change the same call answered **open** — 25 Dec 2026 is a **Friday**, inside the broker week, and `venueForSymbol()` routes UK100/FRA40/GER40/US500/US30/VIX/XAUUSD/EURUSD all through this venue. The endpoint gained a deliberately-refused-unless-parseable `at` parameter so this test can be re-run by anyone at any time (an invalid value returns **HTTP 400**, not a silent "now").

Control, same build: `at=2026-12-24T12:00:00Z` → **open** (the declared gap, below). Holidays endpoint: `GET /api/calendar/holidays?exchange=FX` → **4 rows** (was 0).

**And the gate consumes it** — `protocol-gating.service.ts:1085` calls `getMarketStatus(venueForSymbol(symbol).exchange)` (#850's wiring), so the closure reaches every decision, not just the endpoint. Two other `getMarketStatus('US')` call sites were examined and are correctly US-scoped (a scheduler preflight report; a "US session closing" alert).

### 3. ✅ Fail-closed in spirit — stated precisely

- A **declared** closure is checked BEFORE the open computation, so it cannot be open by construction.
- An **unknown exchange** fails closed exactly as before (#850's pinned behaviour).
- An `early-close` row on this venue is **warned about loudly**, never silently ignored.
- ⚠️ The honest limit: a holiday **absent from the table** is indistinguishable from a normal trading day — inherent to a static source. The second line of defence there is the quote-freshness machinery (#1085), which refuses a frozen feed at sizing. The calendar cannot close that gap alone, and this comment does not claim it does.

### 4. ✅ Early-close handling explicit

**None are declared, and that is documented at the table and enforced in code**: `getWeeklyStatus` logs a WARN if an `early-close` row ever appears for a weekly venue ("treating it as a FULL trading day"), because the weekly model has no intraday close to shorten. 24/31 Dec were deliberately NOT added: brokers differ, and the issue forbids unsourced dates. The 24 Dec control case above pins the declared behaviour so a future change cannot widen the closure silently.

### 5. ✅ Guard + canary

- **4 new cases** in `market-calendar.service.spec.ts` (16/16 total): Christmas 2026 closed + named + next-open instant; New Year 2027 closed; 24 Dec control open; and the two venues provably read their OWN tables (US early-close at the same instant the FX venue is a normal day).
- **Canary** `logs/canary-1088-fx-holidays.ps1`, both directions: **M1** (table row removed) and **M2** (weekly-session lookup disabled) each fail the Christmas/New Year cases; **M2 was also probed ALONE** to prove the integration is independently load-bearing (2 failures with the table intact); restore byte-for-byte verified. `CANARY PASS`.

---

## Deliberately NOT done (declared, not silently skipped)

- **Family-specific holidays** (Thanksgiving for US500/US30 etc.) — need a per-family venue split, and the CFD reality is genuinely murky (CME index futures trade a shortened Thanksgiving). Not guessed. **Note only** — no measured defect exists to file.
- **Early closes** 24/31 Dec — see criterion 4.

**Deploy note:** built via the documented bypass (`tsc -p tsconfig.build.json` + detached restart) because `npm run build:api` is still red on another agent's untracked `RegisterSymbolOverlay.jsx` (notices gate) — all affected gates for THIS change were run individually: decisions, timezone-sources, local-time-sources, timeframe-sources, typecheck, calendar spec.
