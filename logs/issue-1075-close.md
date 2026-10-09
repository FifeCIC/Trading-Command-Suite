## Pre-Close Verification

> ⚠️ This issue has no acceptance criteria. Adding minimal verification:

- [x] **Code is live — services restarted.** `npm --prefix nest run build:api` → *Build succeeded* → API restarted (verified `GET /api/version` → **0.121.6**, mode fallback = normal dev).
- [x] **API returns real data — curl tested.** `POST /api/directives/atr-trailing-stop/test` on 0.121.6, 2026-10-09:
  - **XAUUSD 5m → bearish, 75** — *"Strong downtrend — close 2.29×ATR below short stop (overlap: larger gap wins)"*
  - **EURUSD 5m → bullish, 60** — *"Moderate uptrend — close 1.66×ATR above long stop (overlap: larger gap wins)"*
  - **US30 5m → bullish, 75** — *"Strong uptrend — close 2.47×ATR above long stop"*
  All three returned **neutral 30** before this change (reproduction in the issue body). The directive that contributed directional evidence **0 / 133** live evaluations now speaks.
- [x] **Build passes.** Full `build:api` green (tsc + all prebuild validators; the pipeline-map gate caught and re-derived the arithmetic reclassification itself).

## What the fix is — owner ruling "B" (ATR units), not threshold recalibration

Gap = `(close − stop) / ATR`, graded at **2.0 ATR** (strong, 75) / **0.5 ATR** (moderate, 60) / below (neutral, 30). MIN 25 bars; ATR ≤ 0 returns neutral with a named reason.

**Why the old form could not fire (measured):** for the long stop, `close − (hh20 − 3×ATR) ≤ 3×ATR` while `close ≤ hh20`, so **any** positive grade required `ATR > 1% of price` — the observed 5m ATR is 0.02–0.07% of price. The branches were not mis-tuned; the unit was wrong, which is option B's argument.

**Overlap rule (new, documented):** both stops can be graded when `range(20) < 5×ATR` — the side with the **larger** gap wins; an exact **tie resolves to the long side** (stable sort; long pushed first). The pick is ONE code path with the reason string naming the overlap, so every geometry exercises the same code.

**Guard rail sanity:** `longStop = hh20 − 3×ATR` and the 2×ATR strong band coincide exactly when the close touches the trailing stop — the grades are self-consistent rather than arbitrary.

## Evidence — canaried both directions (2026-10-09)

| Mutation | Observed | Restored |
|---|---|---|
| M1 — fraction-of-price divisor (`/lastClose`) | **5 of 10** specs fail (fix-case, mirror, both overlap cases, + the cross-suite mirror) | ✅ SHA256 identical |
| M2 — ascending pick comparator | **exactly 1** (overlap-pick) | ✅ SHA256 identical |

Green suite after restore: 2 suites / 10 tests. New spec (7 tests) sits beside `stop-directives.spec.ts` (mirror test asserts up.score === down.score).

**Recording — all three homes:** DECISION marker at the code site; `docs/SETTLED-DECISIONS.md` **row 77** (row 76 was taken by #1098 — the first draft of the marker cited 76 and was corrected); this comment. Validator green (77 rows / 32 markers, self-test 19 cases).

## Deliberately unchanged

- **The other fraction sites in the same file** (`sar` SWING distance, `distAboveLong` pattern neighbours) — outside this ruling; each gets its own measurement if it shows the same silence signature.
- **`STOP_GUARDIAN_DIRECTIVES` membership and the `>= 55` threshold** — the directive now contributes in the range the threshold was calibrated for; no change warranted by the evidence.
- **The SILENT contribution guard** shipped earlier in this issue's history (200-evaluation streak, hourly throttle, 8 canary tests) — untouched; it remains the symptom guard for any *future* directive going quiet.
- **No historical calibration existed to preserve** (thresholds introduced once in `c9c1353`, never changed) — noted for the record, not as a reason for inaction.

## Deferred

- **None.** The owner's ruling covered the full fix; the guard, the register row, and the live verification are all in this landing.
