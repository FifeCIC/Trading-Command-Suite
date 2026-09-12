# Handoff → the agent working edge/PnL measurement

**From:** the agent that analysed scores/`trade` P&L today
**Date:** 2026-09-12
**Re:** your `EdgeStatisticsService` / `PnlStatisticsService` / `edge.controller.ts`
**Issue:** #805 (filed) · **Handoff:** `docs/handoff/2026-09-12-805-invalid-pnl-rows-excluded.md`

---

## First — your tooling is sound, and two things you did were better than mine

| You did | I did |
|---|---|
| Found/used `directiveoutcome` (13,773 rows) | Looked only at `score` + `trade`, concluded *"no measurement apparatus exists"* — **wrong** |
| Warned the sample is 4 days | Generalised from an **8-minute** window |

Your split-long/short correction is the single best piece of analysis in this exchange — pooling
had produced *"higher conviction is LESS accurate"*, the opposite of the truth.

---

## One thing I corrected, with evidence

**Your headline finding — "Reward:risk is INVERTED … this points at exits/stops, NOT at entry
scoring" — is not supported. Two measurements:**

**1. The ratio is two trades.**

```
worst loss -65.25 = 69.3% of ALL losses   ->  avgLoss without it: -7.22  (you reported -18.83)
best  win  +55.49 = 62.2% of ALL wins     ->  avgWin  without it: +3.75  (you reported  +8.92)
```

**2. The configured geometry contradicts it.** From `trading_strategy` directly:

| slPct | tpPct | bots | R:R |
|---|---|---|---|
| 1 | 1 | **13** | 1.0 |
| 1.5 | 3 | 3 | 2.0 |
| 0.4 | 0.6 | 3 | 1.5 |
| 3 | 6 | 2 | 2.0 |

**13 of 22 bots target 1:1; the rest target 1.5:1 or 2:1 favourable.** The app is not
configured to target less than it risks. Acting on "inverted geometry" would have sent someone
to fix stops that work.

**3. Your 8.77% win rate was computed over invalid rows.** 82 of your 114 closed trades have
`pnlInvalid=1` and `pnl=0` — missing data, not break-even trades.

| Population | n | Win rate | Break-even |
|---|---|---|---|
| Yours (all rows) | 114 | 8.77% | 32.2% |
| **Valid only** | **32** | **31.3%** | 32.2% |

**8.77% → 31.3%.** Your report implied ~23 points under break-even; it is **within 1 point**.

---

## What I changed (revert any of it — your call)

1. **`pnl-statistics.service.ts`** — excludes `pnlInvalid=1` before any stat; adds
   `sample.excludedInvalid` + `populationNote`.
2. **`edge.controller.ts`** — geometry warning now needs **n≥30** to assert a defect; below that
   it states the ratio as a tail observation and says explicitly it is *not* evidence. Your
   original wording is preserved in a comment explaining why it was narrowed.
3. **`schema.prisma`** — `model Trade` was missing `pnlInvalid`, `pnlInvalidReason`, `pnlRaw`,
   `exitPriceRaw`. **All four exist in the DB.** This is the root cause — Prisma could not read
   `pnlInvalid`, so the filter was impossible to write.

---

## The finding I think is most important, and I did not pursue it

**This is the second DB-vs-model field drift in two days:**

| Field | DB | Model | Effect |
|---|---|---|---|
| `symbol_route.provider` | ✅ | ❌ (fixed 09-11) | Blocked binance route seeding |
| `Trade.pnlInvalid` | ✅ | ❌ (fixed here) | **Produced your wrong verdict** |

**A Prisma model can silently under-report the database.** Both were found by accident, and the
symptom is always the same shape as everything else this week — *plausible output, no error*.

A full `information_schema` vs `schema.prisma` comparison across all ~40 tables is **not done**.
I'd argue that is higher value than #805, and it needs someone who will actually run it rather
than note it.

---

## My recommendation, which you should feel free to overrule

**Do not tune anything yet.** 31.3% vs 32.2% on 32 trades, with one outlier dominating each mean,
cannot distinguish marginally-profitable from marginally-unprofitable. `reliability: noise` is the
correct flag.

**Yours to decide:**
- Keep or revert the n≥30 gate on the geometry warning
- Whether to re-import the 82 rows from MT5, or declare them lost (**they are unrecoverable from
  `pnlRaw` — only 6 distinct values across 82 rows**)
- Whether to do the schema-vs-model sweep
- `edge.controller.spec.ts` still hardcodes `114` in fixtures; tests pass but now describe a
  population that no longer exists

---

## Verified state

```
GET /api/scoring/edge/pnl
  closedTrades 114 · withPnl 32 · excludedInvalid 82
  winRate 31.3% · expectancy -0.1531 · reliability noise
```

`tsc` 0 errors · build green · API **0.6.9** live · contract + agent-docs gates green.

**All temp analysis scripts removed. My working tree is clean apart from the 4 files listed above.**
