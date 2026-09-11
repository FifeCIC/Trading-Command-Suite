---
date: 2026-09-11
area: infra
type: bugfix
---

## What Changed

Fixed an **intermittent false positive** in `INV-NO-FUTURE-ROWS`: the allowance for a
forming bar was **exactly one cadence**, but a bar may legitimately exist for the NEXT
period (the refresh upserts whatever the provider publishes), so a `1m` bar one cadence
ahead was flagged as an orphan — then self-corrected the moment the clock moved on.

## Files Changed

- `nest/scripts/contract-probe.cjs` — `LEAD_FOR` is now `cadence × 2`, not `cadence × 1`.
  Extracted `CADENCE_SECONDS` as a named map. `now` is captured **once** and reused for
  both halves of the `UNION ALL` and the `positions`/`trades` counts, so a row cannot be
  classified against one instant and reported against another. Long doc comment records
  the measured evidence.

## The evidence (why this is a real fix, not a tolerance widening)

Measured live, **same data, no writes between runs**:

| Time | Result |
|---|---|
| `21:58:10` | **FAILED** — `orphans=8 worst=1m @ 2026-09-11T21:59:00.000Z` |
| `21:58:34` | **PASSED** — `orphans=0` |

The `1m` bar at `21:59` led by 90s at `21:57:30` (`90 > 60 + 1` → ORPHAN) and by 25s at
`21:58:34` (`25 <= 61` → ok). The check's verdict depended on the **second it ran**.

This is not a widened tolerance: what the check exists to catch (#750/#780) is a row
skewed by **HOURS** from a broker server/UTC mix-up (~3h leads measured), so
`2 × cadence` still catches it by a wide margin.

| Case | Lead | Old | New |
|---|---|---|---|
| `1m` one cadence ahead (the false positive) | 90s | ORPHAN | **ok** |
| `5m` one cadence ahead | 450s | ORPHAN | **ok** |
| #750/#780 real skew | 10800s | ORPHAN | **ORPHAN** ✅ |

Probe then ran **5× consecutively: 12 passed, 0 failed** every time, plus a further 3×.

## Gates

| Gate | Command | Observed |
|---|---|---|
| **1 STRUCTURAL** | `npx tsc -p tsconfig.build.json --noEmit` | ✅ EXIT=0, **0 errors** |
| **2 CONTRACT** | 4 × prebuild validators + `contract-probe.cjs` | ✅ all EXIT=0; probe **12/12, 3 consecutive runs** |
| **3 STATE** | `node scripts/diff-seed-vs-db.cjs` | ✅ **`drift: 0`** — 47 protocols / 419 placements both sides |
| **4 BEHAVIOUR** | probe run at the previously-failing boundary | ✅ PASSED where it previously FAILED on identical data |

Guard self-test: `test-gate-membership-guard.cjs` ✅ EXIT=0 (still bites on the defect).

⚠️ **One transient during verification, correctly classified.** A run showed
`FAIL [INV-BAR-ORDER] 5m: arena asOf=21:55 newest bar=22:05`. This is the **self-healing
data gap** path that was deliberately added earlier today (#795): the probe reported it as
a data gap, and it cleared on the next run with no code change. **Not a scoring bug.** It is
recorded here because an agent seeing that line would otherwise re-open a settled
non-issue — which is the exact failure this workbook exists to prevent.

## Not Done

- **Not** a change to the `INV-NO-FUTURE-ROWS` *contract* — the contract (no row beyond its
  own bar length, forming bars excluded) is unchanged. Only the tolerance arithmetic moved.
- **Not** applied to `directiveoutcome` separately — `predictedAt` inherits the evaluated
  bar's timeframe, so it is judged by the same cadence map, which is correct.

## Capability Map Entry

- **name:** Contract Probe — Future-Row Detection (cadence-aware tolerance)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Infrastructure
- **name:** INV-NO-FUTURE-ROWS tolerates a one-cadence-ahead bar but still catches an hours-skew
- **procedure:** Run `node nest/scripts/contract-probe.cjs` repeatedly around a cadence boundary (e.g. within 90s before a `1m` minute). Then insert a `marketbar` row dated 3h ahead and re-run.
- **expected:** Repeated runs at the boundary always report `orphans=0` (no intermittency). The 3h-skewed row reports `orphans=1 worst=1m` and FAILs.

## Architecture Framework Entry

- **section:** status
- **summary:** INTERMITTENT GUARD class — `contract-probe.cjs` `INV-NO-FUTURE-ROWS` allowance is `cadence × 2`, not `cadence × 1`, because the refresh legitimately upserts the next period's bar. A tolerance equal to the boundary is a race by construction: the check failed at 21:58:10 and passed at 21:58:34 on identical data. Real skews (#750/#780) are multi-hour, so 2× still catches them. Also: `now` captured once and reused across the `UNION ALL` and the position/trade counts so all judgements share one instant. Files: `nest/scripts/contract-probe.cjs`.
