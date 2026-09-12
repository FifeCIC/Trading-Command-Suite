---
date: 2026-09-12
area: scoring
type: bugfix
---

# #805 — Measurement bug: invalid P&L rows were counted as trades

> **For the agent working edge/pnl measurement.** Your tooling is good; this fixes the
> inputs to it. **Your call whether to keep, change or revert any of this** — the numbers
> below are the evidence, the decision is yours.

## The bug (one line)

`PnlStatisticsService` counted all 114 closed trades, but **82 have `pnlInvalid=1` and `pnl=0`**
from a known bridge defect. Those are *missing data*, not break-even trades.

## Impact — this is why it mattered

| Population | n | Win rate | Break-even needed |
|---|---|---|---|
| Before (all rows) | 114 | **8.77%** | 32.2% |
| **After (valid only)** | **32** | **31.3%** | 32.2% |

**8.77% → 31.3%.** The report said the book was ~23 points under break-even; it is actually
**within 1 point**. Those are opposite conclusions. `expectancy` moved −0.043 → **−0.153**
(honest, because the zeros were diluting it toward zero, not the win rate).

## What I changed

1. `pnl-statistics.service.ts` — excludes `pnlInvalid=1` **before** any statistic; adds
   `sample.excludedInvalid` and a `populationNote` so every number carries its provenance.
2. `edge.controller.ts` — the exit-geometry warning asserted *"Reward:risk is INVERTED … this
   points at exits/stops, NOT at entry scoring."* **That overreached**, for two measured reasons:
   - The 2.11:1 ratio is **two trades**: worst loss −65.25 = 69.3% of all losses; best win +55.49
     = 62.2% of all wins. Without them: avgLoss −7.22, avgWin +3.75.
   - **Configured geometry contradicts it** — 13 of 22 bots set `slPct 1 / tpPct 1` (1:1), the
     rest 1.5:1 or 2:1 favourable. The app is not set up to target less than it risks.
   - Now: asserts a geometry problem only at **n≥30**; below that it reports the ratio as a
     *tail observation* and explicitly says it is not evidence of a defect.
3. `schema.prisma` — `model Trade` was missing **`pnlInvalid`, `pnlInvalidReason`, `pnlRaw`,
   `exitPriceRaw`**. All four exist in the DB. **This omission is the root cause**: Prisma could
   not read `pnlInvalid`, so the guard could not be written even if intended. Fixed.

## ⚠️ The schema finding is bigger than this bug

This is the **second** field-drift of the same shape in two days:

- `symbol_route.provider` — in the DB, absent from the model (blocked binance route seeding)
- `Trade.pnlInvalid` — in the DB, absent from the model (caused this wrong verdict)

**A model can silently under-report the database.** Both were found by accident. Worth a
repo-wide comparison of `information_schema` against `schema.prisma` — I have **not** done
that, and I think it is the higher-value follow-up.

## ⚠️ What I did NOT do

- **Did not re-import or repair the 82 rows.** They are **unrecoverable**: all 82 have
  `pnl = 0`, and `pnlRaw` has only **6 distinct values** across them (e.g. 26 EURUSD trades all
  share `exitPriceRaw 1.16257`). One exit price was written across a whole batch. Reconstructing
  them would fabricate data. **Options: re-import from MT5, or declare lost. Your call.**
- **Did not touch `edge-statistics.service.ts`** — its directional analysis is unaffected (it
  reads `directiveoutcome`, which is sound). Only the PnL side was wrong.
- **Did not fix the hardcoded `114`** still in `edge.controller.spec.ts` test fixtures — tests
  pass, but those literals now describe a population that no longer exists.
- **Did not verify the 29 open trades close into valid P&L.** Writer is fixed; inference only.
- **Did not resolve the disagreement about outliers**: the −0.153 expectancy is real arithmetic
  but rests on 5 losses, one of which is 69% of the total. `reliability: noise` is correct.

## Verification

| Gate | Observed |
|---|---|
| STRUCTURAL | ✅ `tsc --noEmit` 0 errors |
| CONTRACT | ✅ build succeeded, prebuild validators green |
| STATE | ✅ API 0.6.9 live; `/api/scoring/edge/pnl` → `withPnl: 32, excludedInvalid: 82` |
| BEHAVIOUR | ✅ win rate now reports **31.3%**, not 8.77%; geometry warning fires at 32 trades with the "check whether this is geometry or outliers" wording |

## The honest bottom line

**The book is 31.3% against a 32.2% break-even line, on 32 valid trades, with one outlier
dominating each mean.** That is not a diagnosis — it is a statement that **the sample is too
small to distinguish "marginally unprofitable" from "marginally profitable"**.

**Recommendation: do not tune anything yet.** With 82 invalid rows now excluded, 29 open
positions accumulating, and the writer fixed, the sample doubles in weeks. Tuning now = fitting
to 15 non-zero outcomes.

## Capability Map Entry

- **name:** P&L Population Integrity (invalid-row exclusion)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** PnL report excludes pnlInvalid rows and reports which population it used
- **procedure:** `GET /api/scoring/edge/pnl` against a DB containing `pnlInvalid=1` rows
- **expected:** `sample.excludedInvalid > 0`, `sample.withPnl` = valid count only, and a non-empty `populationNote` naming the exclusion. Win rate computed over the valid set.

## Architecture Framework Entry

- **section:** data
- **summary:** Trade P&L validity. `Trade` gained four model fields that already existed in the
  DB (`pnlInvalid`, `pnlInvalidReason`, `pnlRaw`, `exitPriceRaw`) — the omission let a verdict
  compute an 8.77% win rate over 82 unusable rows instead of 31.3% over 32. All P&L statistics
  must exclude `pnlInvalid=1` and must state their population. Second instance of DB-vs-model
  field drift in two days (cf. `symbol_route.provider`). Files:
  `pnl-statistics.service.ts`, `edge.controller.ts`, `schema.prisma`.
