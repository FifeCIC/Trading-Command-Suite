## Pre-Close Verification — the family is now MEASURED or SILENT, and the build enforces it

- [x] **Each of the 12 calendar directives has a measured basis, or scores 0 with `neutral`.**
  `friday-drift` (refuted 2026-09-18, pre-existing) and `monday-effect` are **retired with a measurement**; the other 10 are **retired as unmeasurable on this history** (see the table — a seasonal/monthly claim needs decades, and the daily bars span 2025-12-25 → 2026-10-08). The same sweep caught **5 more dated-bias classes** the original audit missed (below), each retired the same way.
- [x] **No calendar directive returns a non-zero score on a non-event day (mode 3).**
  Every retirement returns `score: 0, unmeasured: true` on **every** day — verified live on 0.123.0 (`monday-effect`, `spy-month-end-rebalancing`, `weekly-rhythm-strategy` → `score=0, unmeasured=True`). The old floors died with them: friday-drift's 2/day, monday's 2/day, sell-in-may's 3, santa's 5, opex's 2, triple's 1, election's 3-8/day, spy-month-end's ≥10/day, isa's ≥5/day, institutional-timing's ≥10/day, friday-positioning's ≥8/day, spy-options-expiry's ≥10/day, basic-weekly-rhythm's ≥10/day, weekly-rhythm-strategy's ≥12/day.
- [x] **A canary: a deliberately false calendar claim fails the build.**
  New invariant **`INV-NO-UNMEASURED-CALENDAR-CLAIM`** (`validate-pipeline-contracts.cjs`, runs in `prebuild`): a class branching on a day-of-week/month/year getter and emitting **any** non-`0` score must carry a `MEASURED` citation. **Canaried 2026-10-09:** a deliberately-injected class (`new Date().getDay()` + `score: dow === 1 ? 3 : 0`, no citation) **FAILED the build, exit 1, naming the class**; the retired family and the 5 whitelisted structural uses pass in the same run. Contract row + QA entry `qa-contract-035` added.
- [x] **`friday-drift`'s `directionBias` no longer asserts `bullish`.** Retired 2026-09-18 — verified in the file today (`directionBias: 'neutral'`, returns 0/unmeasured).
- [x] **The weekend-gap differential, where adopted, is computed from data at scoring time.** Adopted as `weekend-gap-bias.directive.ts` (2026-09-18): it measures the gap from the bars it is given, against the same symbol's weekday gaps — the issue's numbers are cited as evidence, never hardcoded.

## The measurements (difference-in-differences, own-symbol control — the friday-drift method)

| Claim | Measured | Verdict |
|---|---|---|
| friday-drift: "Fridays close higher ~58%" | **50.7% vs a 52.7% baseline** (37 symbols) | Refuted — retired (2026-09-18) |
| monday-effect: "Mondays worst day" | mean Monday-vs-other down excess **+0.44pp (t=0.36)**; **0 of 45 symbols** ≥3.2σ | Refuted — retired |
| turnaround-tuesday: "Tuesday reverses Monday" | P(Tue up \| red Mon) lift **+0.35pp (t=0.30)**; **0 of 45** ≥2σ | Refuted — retired |
| crypto-weekend: "weekends lower volume" | Sat volume **48–63% of the weekday mean** (BTC/ETH/SOL, 29 sessions each) | **Measured TRUE** — kept, now cited in the code; the unmeasured **Monday-bullish 40** and weekday constant 10 were REMOVED |
| The other 10 (Sept/Sell-in-May/OpEx×2/Triple-witch/Election/Santa/January/October/ISA/SPY-month-end) | 0–10 events in the sample (1 September, 1 January, 0 Oct-15-31 windows, 0 completed 4-year cycles…) | **Unmeasurable here** — retired with the counts named in each reason |

⚠️ **Bar-label dependency discharged:** `#880` (closed) established bars are stamped session-START with a Sun–Thu week and that `DAYOFWEEK=Friday` matches **nothing** — which means the OpEx/triple-witching claims could not have fired from a daily bar even if true. That caveat is recorded in both files.

## Found beyond the original 12 — five more dated-bias classes, same shape

`friday-positioning`, `spy-options-expiry`, `basic-weekly-rhythm`, `institutional-timing`, `weekly-rhythm-strategy` — day-of-week **lookup tables scoring EVERY day of the week** (1–55 points) with no measurement behind any cell. All five were `beta` (excluded by the readiness gate, so dormant), all five retired. The scan that found them is the new invariant; the issue's original list came from the runtime guard, which cannot see per-day tables.

## ⚠️ Registration reality (measured, #890's class — reported, not fixed here)

Of the 19 classes involved, **only 9 are actually registered** in the live registry (`GET /api/directives` on 0.123.0): spy-month-end-rebalancing, isa-reset, monday-effect, crypto-weekend-effect, friday-positioning, spy-options-expiry, basic-weekly-rhythm, institutional-timing, weekly-rhythm-strategy — all now show their "(retired)" names and return zero. The other 10 (`september-slump`, `sell-in-may`, `friday-drift`, `election-cycle`, `opex-gamma`, `santa-claus-rally`, `january-effect`, `october-relief`, `triple-witching`, `turnaround-tuesday`) are **in `providers` but have no `register()` call** — so several of the issue's "fixed scores contributing to every composite" **never entered a composite at all**. That is #890's exact lesson ("being in providers is not the same as being registered") and it is left to that class of work rather than smuggled in here.

## Deliberately unchanged / deferred

- **The 5 whitelisted structural uses** (gold-session-profile, volume-rhythm, rollover-risk, session-open-effect, session-timing-filter) — getters gate market-open/settlement/session mechanics, not dated biases; each entry carries its reason and the allowance only shrinks. ⚠️ Recorded residual: session-timing-filter's 0.7 Monday-early/Friday-late liquidity dampeners are heuristics, not measurements — direction-neutral, noted for future measurement.
- **Registering the 10 unregistered classes** — NOT done: registration would change `GET /api/directives` and potentially protocol placement; that is #890-class work, and the classes are now honest zeros in any case.
- **`Deferred:** btc-halving-cycle / earnings-momentum / social-buzz date-constant values are justified in #766's audit (date-phase IS the measurement / honest zero naming the missing feed) — not this family's defect class.
