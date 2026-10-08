## Pre-close verification — #758 ✅

**This issue was closed once, reopened for the classification half, and has sat open since 2026-09-10 with the work actually landed. Verified against the live system today.**

> ⚠️ No formal acceptance checkboxes existed — using the fallback checklist plus the issue's own three named defects.

### The issue's three defects, each verified

| # | Defect | Status | Evidence |
|---|---|---|---|
| 1 | **Unstable denominator** (denominator flipped per tick / per group) | ✅ FIXED | Denominator is CONFIG-derived and stable: per protocol, `MIN(configuredSignalMax) = MAX(configuredSignalMax)` over 7 days of live rows (e.g. `forex-session-v1` 725 across 4,714 ticks; `xau-speed-*` 910/1,010) — previously "five different denominators in 30 minutes" |
| 2 | **`rawMax = 0` phantom zero** written as a legitimate `HOLD` | ✅ GONE | `SUM(breakdown->>'$.rawMax' = 0)` over the last 3 days = **0** across 10,457 rows |
| 3 | **A third shape** — thin duplicate rows (8 keys, no `rawMax`/`marketStatus`) shadowing the rich row | ✅ FIXED | Rich rows: 0 thin rows today; residual **9 rows in 3 days (0.09%)**, all from the declared `signals-workbench` fallback which now **adopts the gating row within 60s when one exists** (see declared residual below) — was **~47%** of all rows measured 2026-09-10 |

### The reopen reason — verified fixed

The 09-10 reopening said the **classification percentage** still divided by the *observed* denominator. Code today (`protocol-gating.service.ts`): `signalPct = normalizeScorePercent(selectedEvidence.raw, signalDenominator)` with `signalDenominator = capacityMaxTotal` (configured) — "the ONE number used for the BUY/HOLD/SELL classification AND displayed on the card". Pinned by `weight-strategy-inert.spec.ts` (`meta.configuredSignalMax = 160`, `!== observedSignalMax`). Live consistency: a STRONG_BUY row at rawComposite 110 / capacity 795 = 13.8% ≥ 13 ✓; a BUY row at 59/725 = 8.1% ∈ [6,13) ✓.

### Fallback checklist

- [x] Code is live — services running; values + classification observed in live rows and the API today
- [x] API returns real data — `GET /api/scoring/gated/thresholds` and direct DB queries above
- [x] Guards exist for the class — `directional-capacity-contract.spec.ts` (capacity rule), `weight-strategy-inert.spec.ts` (configured-denominator pin), `INV-STABLE-DENOMINATOR`, `signal-threshold-scale.spec.ts` (added 2026-10-07)

### Declared residual (not concealed)

The `signals-workbench` write path (`SignalEnvelopeService.persistScores`) still creates a **thin fallback row** when no gating row exists for that symbol within 60 seconds (≤5/day; 9 in the last 3 days). It **shadows nothing** — a rich row is not being hidden, because the fallback only runs when no rich row is present. Its purpose is real (`scoreId` for the workbench + `signaloutcome` recording). Left as-is deliberately: extracting it into its own issue would create tracking artefact without a measured money-path cost; if the runs view ever misreads a thin row, reopen this issue with the row id.
