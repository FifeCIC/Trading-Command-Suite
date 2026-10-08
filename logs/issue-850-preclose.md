## Pre-close check — 4 of 5 criteria met and verified; criterion 3 split out and this closes

### Acceptance criteria

- [x] **`UK100`/`FRA40`/`GER40` report their own venue's status, verified against a live clock.**
      ⚠️ **Verified in the exact window that separates the two calendars.** At **2026-10-08 07:47 UTC** —
      inside the European cash session, with the US in **pre-market** —

      ```
      GET /api/scoring/gated/FRA40?protocol=cac-speed-v1
        marketStatus: {"open":true,"stale":false,"reason":"CFD (broker week): open"}
        signal      : STRONG_BUY   composite 145   signalPct 19.35
      ```

      The old defect's own string was `US market after-hours`. It is now **`CFD (broker week): open`**, and
      the instrument scores instead of being discarded. Deployed `venueForSymbol()`:
      `UK100`/`FRA40`/`GER40` → `{kind:'venue', exchange:'FX', label:'CFD (broker week)'}` — **never `US`**.
- [x] **No symbol inherits the US calendar by default; an unmapped symbol is surfaced.**
      `venueForSymbol('ZZZUNKNOWN')` → `{kind:'unknown', label:'unassigned'}`, and the gate's `else` branch
      **warns by name** (deduped via `unassignedPatternWarned`) and falls back to **data freshness only** —
      which is a real gate, not a US assumption. The comment there is explicit: *"Do NOT silently inherit US
      hours — that silence IS the defect (#850)."*
- [ ] **Holidays are covered for each added exchange.** ⚠️ **NOT MET — extracted to #1088.** `US` has 36
      holidays; **`FX` has 0**, and `FX_SESSION` covers only weekends. Since `venueForSymbol()` routes
      **every continuous CFD** to `FX` (UK100/FRA40/GER40/US500/US30/VIX, plus metals and FX), **Christmas
      Day 2026 — a Friday inside the weekly window — would read as open**. Not fixed here because #850's own
      constraint forbids inventing hours, and the FX holiday source is a decision, not a table.
- [x] **The VIX short reaches the queue when its instrument is tradeable.**

      ```
      strategy_signal_queue: VIX  status=executed  createdAt 2026-10-08 07:03:08
      decision_log (3 days): OBSERVED 75 · SKIP 5 · EXECUTED 3 (newest 07:10:52 today)
                             BLOCKED 19 — all 2026-10-07, the daily-loss day
      ```

      The bot exists and is live: `VIX Spike Short (demo proof #772)`, symbol VIX, mode `auto`, `active=1`.
      ⚠️ **The gate is no longer what stops the short** — which is the substance of this criterion and of
      #770. The 19 blocks are a *different* gate and all pre-date today.
- [x] **A guard exists so a newly added index cannot default to US hours silently.**
      `market-patterns.spec.ts` + `protocol-gating.venue-standby.spec.ts` →
      **2 suites / 21 tests pass**.

### The fix is not the one the issue proposed, and that is the right outcome

The issue's *"Proposed order"* said to add exchanges (London, Frankfurt/Paris, US) and map symbols to them.
What shipped instead routes index CFDs to the **broker's continuous CFD week** — and `market-patterns.ts`
documents why: cash-exchange hours would have been *invented*, which this issue forbids in its own words.
**The criterion's intent (not US) is met; its letter ("their own exchange") is met by the venue they
actually trade on.**

### Not done by this closure

Nothing was executed by writing this comment — the fix landed 2026-09-17 and its groundwork 09-19. This is
the verification the 09-19 comment said was still owed, plus the live clock test.

**Extracted:** **#1088** — the FX venue has no holidays.
