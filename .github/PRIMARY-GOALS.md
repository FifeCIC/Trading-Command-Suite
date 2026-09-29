# Primary Goals

**Status:** active
**Category:** A (agent-operational)
**Created:** 2026-09-29
**Last updated:** 2026-09-29
**Owner:** primary agent

---

## Why this file exists

**~15 open issues cover exit management, and nothing declares which one comes first.**

Measured 2026-09-29: `#916 #917 #928 #998 #1016 #1017 #990 #930 #982 #771 #758 #691` all touch
exits, stops, trails or protection. Several describe **the same defect in different words** — `#916`
says *"winners exit at a third of their target while losers reach the stop"*; `#917` says *"its
winner closed at 14% of target"*. Both are true. Neither is a plan.

This file is the **order**. It is deliberately a description of *what IS* and a pointer to the issue
that owns each piece — never a task list (see `documentation-standards.instructions.md` §5; open work
lives in the tracker, and `scripts/validate-agent-docs.cjs` fails the build on a checkbox here).

**It does not replace `#930`.** `#930` is the adopted sprint and this orders the **exit half** of it.

---

## 1. The goal, stated once

> **A steady climb in profit — which requires the app to close a position on its own analysis.**

Everything below serves that sentence.

## 2. The measured state

Source: `trade` table, `status='closed' AND pnlInvalid=0`, read 2026-09-29.

| Reading | Value |
|---|---|
| Valid closed trades | **168** |
| Total / average P&L | **−145.76** / **−0.868** |
| Win rate | 48.4% (75W / 80L) |
| avgWin : avgLoss | **+4.556 : −6.093** → adverse **1.34×** |
| **Win rate needed to break even** | **57.2%** |
| Configured stop / target distance | 0.982% / 1.666% (R:R ≈ 1.7:1 **in our favour**) |
| Realised move | **+0.23%** — **~14% of the target captured** |
| **Closes driven by a score or signal** | **0** |

**By `closeReason`:**

| Bucket | n | Total | Avg | What it means |
|---|---|---|---|---|
| `broker:sl` | 30 | **−308.62** | −10.29 | the broker stop — **the entire loss** |
| `broker:terminal` | 60 | +143.24 | +2.39 | **unattributed**; `close-reason.ts`: *"`user:manual` would claim knowledge we do not have"* |
| `system:time-stop` | 46 | −44.5 | −0.97 | **17.5 h** average hold |
| `broker:unknown` | 20 | +5.93 | +0.30 | |
| `NULL` | 12 | +58.19 | +4.85 | |

Buckets reconcile exactly: `−308.62 + 143.24 − 44.5 + 5.93 + 58.19 = −145.76`.

## 3. The single cause we can act on

**The app has no exit.** Not a weak exit — **none that has ever executed**:

- the 5 exit directives live in `mt5-technical-core-v1`, which is **inactive** — `#1017`
- `simTsl` records a decision point and **places/moves nothing** — by design, `#936`
- `ExitSignalService` is advisory and reads the **Trading 212** book, not the 40 MT5 positions
- `ExitConsensusService` computes the verdict and **places nothing** — `#1016`

`exit-consensus.service.ts` states it directly: *"a position had exactly one protective actor: the
broker stop, plus the owner's hand."* The data agrees — **0 of 168 closes were score-driven.**

So: **entered on a score, exited by a stop or by hand.** Winners exit flat, losers pay in full.

## 4. What has already improved — do not regress it

| | 2026-09-12 (`n=114`) | 2026-09-29 (`n=168`) |
|---|---|---|
| Win rate | 8.77% | **48.4%** |
| Loss : win | 2.11× | **1.34×** |

The entry-side work is real and working. **The exit is the untouched half** — which is why the
remaining gap to 57.2% is not a scoring problem.

## 5. The order of work

The dependency is strict. Measurement is worthless without a change to measure; a change is
worthless unmeasured.

```
 instrument ──► exit inputs ──► verdict verified ──► verdict TRUSTWORTHY ──► ONE ACTING EXIT ──► payoff settled
 (#965)         (#1017)          (#1016)              (#1020)                 (#1019)              (#916, #917, #998)
```

| Step | Owner | Why here and not later |
|---|---|---|
| **1. The instrument** | **#965** (+ `#980`/`#986`, other agent) | **The critical path.** Any exit change is a maths change, and live A/B **cannot** measure it: test `b50727ee` wrote **56 rows for 4 real trades (A 3, B 1)** because each arm holds one position per symbol. The sample must come from the **backtest**. |
| **2. Give the exit real inputs** | **#1017** — *closed 2026-09-29* | The 5 exit directives have never run — 0 appearances in 6,693 score breakdowns. The verdict cannot be better than its inputs. |
| **3. Verify the verdict** | **#1016** | `ExitConsensusService` is built but unverified. Verifying costs little and prevents building on an unknown. |
| **3b. Make the verdict trustworthy** | **#1020** | Measured 2026-09-29: **`regime-shift-exit` and `time-stop` hardcode `signalClass: 'neutral'`**, and `arguesExit` reads *only* `signalClass` (`exit-consensus.service.ts` L447-448) — so **2 of the 5 exit directives can never argue an exit, even at score 100**. A verdict missing two of its five inputs is not one to act on. **Settle the contract BEFORE #1019 wires it.** |
| **4. One acting exit, as a COPY** | **#1019** | The goal of the sprint. Per `maths-change-requires-ab`, the incumbent keeps running untouched and both configurations exist together. |
| **5. Settle the payoff** | **#916, #917, #998** | These describe the defect the acting exit is meant to move. They are the *acceptance test* for step 4, not a parallel workstream. |

**Do not reorder steps 1 and 4.** Building the exit before the instrument produces a change nobody
can evaluate, which is how the last year of scoring iterations happened.

## 6. Standing constraints

- **Never edit live maths in place.** Copy the configuration (`maths-change-requires-ab`).
- **Risk paths keep full care** regardless of demo accounts (`development-status`).
- **A defect is fixed on its own evidence, not gated on a test.** `#927` closed 7 positions in one
  morning and was fixed without waiting for A/B. The *fix* is never contingent on the test; the
  *optimum* is.
- **Check `docs/SETTLED-DECISIONS.md` before touching an area this file names.** Re-opening a
  settled decision by accident is the most expensive thing that happens here.

## Related

- `.github/AGENT-ATTENTION.md` — blockers
- `docs/SETTLED-DECISIONS.md` — settled decisions and their guard status
- `#930` — the adopted sprint this file orders the exit half of
- `#965` — the instrument (A/B via backtesting)
- `#1017` — the exit inputs (**closed** 2026-09-29; its fix is `#1020`)
- `#1020` — the exit-verdict contract (step 3b)
- `#1019` — the acting exit (step 4)
- `#916`, `#917` — the payoff defect the exit exists to move
