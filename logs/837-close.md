## Close report — #837: the proposed invariant was MEASURED and REFUTED; the detection lives where the two cases are separable

**Verdict: the rule as specified cannot ship as a gate.** It fires hundreds of times a day on healthy data — the exact "guard that gets allowlisted" failure this repo names. Live measurements (`marketbar`, 3-day window, 2026-10-09) and what shipped instead are below.

### The measurement that decided it

| Form of the proposed rule | Hits in 3 days of LIVE data |
|---|---|
| `open == prevOpen AND prevClose <> prevOpen` (as written in the issue) | **1,797** |
| narrower: `+ close == prevClose` | **3,992** |
| narrowest: `+ high/low/close all equal to previous` | **2,860** |

Sample of the first form: `open 109.10 / prevOpen 109.10 / prevClose 109.09` — a one-tick retrace that returns to the same price. On 1m bars of a quiet symbol that is routine; the histogram is dominated by 1m (1,390) then 5m (295), 15m (97). **A genuine next bar's open equals the prior CLOSE, and on a quoted grid the close is only a tick away from the prior open** — so "identical opens" cannot separate a duplicated bucket from ordinary movement. The issue's premise (*"it can only fire on genuinely duplicated periods"*) is refuted by measurement, including every narrower form tested.

### What shipped instead

1. **`DUPLICATE-BUCKET-COUNT`** — an **informational** line in `nest/scripts/contract-probe.cjs` (24-hour window). It RECORDS the count and never fails. It is the number an investigator greps for; `ok: true` on that line is explicitly **not a claim of health** (stated in the probe comment). Canaried: synthetic duplicate row inserted → count moved **589 → 590** → row deleted → count returned to **589** (`during >= before+1 → True; after == before → True`).

   ⚠️ The first canary attempt showed `DURING == BEFORE` and was INVALID as a test, not a failure of the counter: the anchor minute (`22:02`) already had a real successor bar queued, so the inserted row was not the immediate successor in the LAG chain. The fixed canary anchors on a minute with NO successor (`NOT EXISTS … T+1min`) so the inserted row is provably adjacent. Recorded because a canary that passes for the wrong reason is worse than none.
2. **The detection half lives at WRITE time**, which is the only moment the two cases are separable — a just-published next bar is legitimately ahead of the clock, a re-described period is ahead of it by the same scale, but a *forged* row appears where the FORMAT demands a lead bound. That guard already exists: `isBarFutureStamped` (2-minute bound), wired into **both** writer paths (`bar-refresh.service.ts`, `import-jobs.service.ts`), pinned by `bar-future-stamp.spec.ts`.
3. **`LEAD_FOR` reconciled — `2 ×` STAYS**, with the reasoning recorded at the code site so it is not loosened a third time for a case it was never built to catch: it is an HOURS-scale skew detector (#750 measured ~3h), the 52-minute #832 lead sits inside `4h × 2` **by design**, and tightening it would re-introduce the structural boundary race (measured 21:58:10 vs 21:58:34 — same data, opposite results). Re-measured 2026-10-09: **zero** rows led the clock.

### Acceptance criteria — resolved honestly

- [x] Probe entry added — as a **non-failing count**, with the refutation documented in full at the site (`npx jest`-style gating was considered and rejected **on evidence**, not preference).
- [x] Fires on a synthetic row — count 589 → 590 → 589 (canary `logs/canary-837.ps1`, second run after the anchoring fix). It does **not** "fire" as a failure on live data because it CANNOT: 1,797/3d is the refutation.
- [~] Historical #832 case — the reconstruction in the issue shows the spurious row's close DIFFERS from its twin's (4302.50 vs 4300.35), so the form that matches #832 rows is exactly the open-equality form measured above. It is caught by the writer guard, not by a data scan. **Stated rather than implied.**
- [x] `LEAD_FOR` reconciled (item 3 above).
- [x] Decision recorded: `2 ×` retained, with the REVERSE BY being a re-measurement of legit leads per cadence.

**What I did NOT do:** ship a failing duplicate-bucket gate. It would have been a decoration with a ~600/day false-positive rate.
