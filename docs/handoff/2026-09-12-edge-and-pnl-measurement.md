---
date: 2026-09-12
area: scoring
type: feature
---

# Edge & PnL measurement — a tool to answer "is this worth building?" with evidence

> **Trigger.** The owner set a condition for continuing development: *"I don't want to continue
> building on the project unless a change will have a positive impact on profitable trade."*
> Answering that needs a measurement tool, which did not exist. This builds it.

## What Changed

Added three things that make the owner's question answerable, then **used them to produce a
first real finding** that neither of us had established before.

## Files Changed

- `nest/src/modules/scoring/edge-statistics.service.ts` — **NEW.** Directional edge with Wilson
  95% intervals and exact binomial tests vs p=0.5. Always splits long/short.
- `nest/src/modules/scoring/edge-statistics.service.spec.ts` — **NEW.** 19 tests.
- `nest/src/modules/scoring/pnl-statistics.service.ts` — **NEW.** Expectancy, profit factor and
  reward:risk by side/source/strategy.
- `nest/src/modules/scoring/pnl-statistics.service.spec.ts` — **NEW.** 14 tests.
- `nest/src/modules/scoring/edge.controller.ts` — **NEW.** `/api/scoring/edge/{report,pnl,verdict}`.
- `nest/src/modules/scoring/scoring.module.ts` — registered the three above.

**Realised result at time of writing (2026-09-12, /api/scoring/edge/verdict):**

| Metric | Value |
|---|---|
| Verdict | `insufficient-data` |
| Matured predictions | 12,471 (10,772 with resolved direction) |
| **Distinct days** | **4** |
| Closed trades with PnL | 114 |
| Win rate | **8.77%** (10 of 114) |
| Avg win / avg loss | +8.92 / **−18.83** |
| Profit factor | **0.948** (below 1.0) |
| **Expectancy** | **−0.043 / trade** |
| Total PnL | −4.9 over 13 days |

## ⚠️ THE FINDING — this is the point of this handoff

**Reward:risk is INVERTED, and that is a cheaper explanation for the negative expectancy than
anything in the scoring.**

Average loss (−18.83) is **2.11×** the average win (+8.92). At that ratio the system needs a
**~68% win rate** merely to break even; the book is at **8.77%**. So:

- A poor expectancy here is **primarily a stop/target geometry problem**.
- **Changing entry scoring would not fix it.** Improving directional accuracy from 51% to 60%
  would not overcome a 2.1:1 adverse reward:risk with an 8.8% win rate.
- The verdict output now states this automatically, before any scoring conclusion.

⚠️ **`reliability: noise`** — n=114 is too small to *prove* this. But this is not a subtle
statistical claim: a 8.77% win rate against 2.1:1 adverse geometry is a **structural** mismatch
visible without inference. It is the first thing to investigate, and it is cheap to check
(stop and take-profit distances are known per trade).

## ⚠️ How this CONTRADICTS the earlier same-day analysis — read both

`2026-09-12-scoring-predictive-content-measured.md` concluded from **directional accuracy** that
bearish signals had edge (52.4% vs bullish 40.3%, with positive signed return on bearish).

**Both are true and they are different questions.** Directional accuracy asks "did price move
the way the signal said". Expectancy asks "did we make money". The second is the one the owner's
condition is about, and it is **negative**. The gap between them is exactly why this tool exists.

## Design decisions worth preserving

| Decision | Reason |
|---|---|
| **Never pool long and short** | Pooling produced "higher conviction is LESS accurate" (50.2%→38.2%). Split by direction, bearish was monotonic and bullish inverted. The pooled number pointed at the wrong conclusion. |
| **Wilson, not normal, interval** | Normal intervals break down at small n and near 0/1; Wilson behaves. Typical n here is tens-to-hundreds. |
| **Exact binomial, not normal approx** | n is small; the normal test would over-claim significance. |
| `insufficient` below 30 samples | A point estimate at n=4 invites over-reading. The verdict refuses to offer one. |
| Expectancy is the headline, not win rate | A 70% win rate with negative expectancy loses money. Tested explicitly. |
| `avgLoss` stays NEGATIVE | Treating it as a magnitude is how a sign bug produces a *positive* expectancy for a losing system. |
| `profitFactor` uses a finite sentinel | `Infinity` serialises to `null` in JSON and reads like a bug. |

## Bugs I introduced and fixed during this work

1. **Duplicate `closedAt` key** in the Prisma `where` — caught by `tsc` (`TS1117`). Would have
   silently dropped the not-null filter and let open trades into the expectancy maths.
2. **Hardcoded "grow past 100 trades"** while the value was already 114 — the tool wasn't
   reading its own data. Now computed, and says so when the target is already met.
3. **⚠️ The exit-geometry warning was COMPUTED THEN SILENTLY DISCARDED — twice.**
   `decideVerdict` pushed the warning into `findings`, then the `days < 30` early-return branch
   **rebuilt `findings` from a literal array**, dropping it. The endpoint returned a complete,
   well-formatted verdict that simply omitted its most actionable sentence. Nothing errored.
   Fixing that branch revealed the **same bug in the `losing` branch**. Both now spread
   `...findings`.

   **This is the third instance in one day of the same class** (a value computed and not used,
   with no error) — alongside `INV-SINGLE-CADENCE` reporting the same boolean as
   `INV-BAR-ORDER`. Recorded in repo memory as `computed-but-not-used.md`.

   `edge.controller.spec.ts` (8 tests) now guards it, and **caught the second instance within a
   minute of being written** — which is the argument for writing the test even when you are
   confident the code is right.

## Not Done / limits

- **The outcome pipeline's `directionCorrect` horizon is not separated in this report.** A 15m
  "correct" and a 24h "correct" are aggregated together. Splitting per horizon is a sensible
  follow-up and is **not implemented**.
- **No UI.** These are API endpoints only. The owner asked for reduced surface area, not more
  pages, so no page was added.
- **No exit-geometry analysis beyond the warning.** The tool detects and states the inverted
  reward:risk but does not yet attribute it to specific stops/targets.
- **`days` defaults differ** per endpoint (30 for edge, 90 for PnL). Deliberate — edge matures
  faster than closed trades — but worth knowing when comparing.

## Gates

| Gate | Observed |
|---|---|
| STRUCTURAL | ✅ `tsc --noEmit` 0 errors |
| CONTRACT | ✅ **41 tests pass** (19 edge + 14 PnL + 8 verdict); prebuild validators green |
| STATE | ✅ `drift: 0` — 47 protocols / 419 placements |
| BEHAVIOUR | ✅ `/api/scoring/edge/verdict` returns the exit-geometry finding **live** (verified in `dist`, not just in source) |

⚠️ **Two process lessons from this session:**
1. **`build` while the API is running is refused by design.** The `build-preflight` guard named
   the Prisma DLL lock and the correct command (`build:api`). The guard worked; I had used the
   wrong script.
2. **I twice reported "dist is STALE" from a bad `Select-String` pattern**, not from reading the
   file's contents. `tsc` rewrites the source, so grepping for a source-format pattern gives a
   false negative. **Verify a build by searching for a distinctive emitted STRING** (e.g.
   `'Reward:risk is INVERTED'`), not by pattern-matching the source syntax.

## Capability Map Entry

- **name:** Edge & PnL Measurement (confidence intervals + expectancy)
- **persistence:** ephemeral (computed on demand from stored outcomes/trades)
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete — with an explicit list of what it cannot yet establish

## QA Test Entry

- **area:** Scoring
- **name:** Edge verdict refuses to over-claim on a small sample
- **procedure:** `GET /api/scoring/edge/verdict`. Then check `scoreBands` in
  `GET /api/scoring/edge/report` and confirm long/short are reported separately.
- **expected:** `verdict: "insufficient-data"` while `sample.distinctDays < 30`, with
  `notEstablished` naming what cannot be concluded. Directional figures appear **split by
  direction**, never pooled-only.

## Architecture Framework Entry

- **section:** data
- **summary:** Edge & PnL measurement added — `/api/scoring/edge/{report,pnl,verdict}`.
  Wilson 95% intervals + exact binomial tests on `directiveoutcome`, always split long/short
  (pooling inverted the conclusion on 2026-09-12). Expectancy/profit-factor by
  side/source/strategy from `trade`. **First finding: reward:risk is INVERTED (avgLoss 2.11x
  avgWin, 8.77% win rate, profit factor 0.948, expectancy −0.043) — points at exits/stops, not
  entry scoring.** Sample is 4 days / 114 trades; verdict correctly reports
  `insufficient-data`. Files: `edge-statistics.service.ts`, `pnl-statistics.service.ts`,
  `edge.controller.ts`.
