## Pre-Close Verification

All five acceptance criteria from the issue description, each actually checked rather than
assumed.

---

- [x] **1. `importBars()` floors every timestamp to its declared timeframe boundary; a `1h` bar submitted at `13:30` is stored at `13:00` and reported as `skipped` when a `13:00` bar already exists.**

Verified **against the live API** (throwaway symbol, since removed):

```
1. real bar 13:00  -> { imported: 1, skipped: 0, misaligned: 0, invalid: 0 }
2. twin at  13:30  -> { imported: 0, skipped: 1, misaligned: 1 }   <-- stored as 13:00, rejected
```

`alignBarTimestamp()` lives in `nest/src/common/utils/timeframe.ts`; `importBars()` calls it
before insert. Flooring, never rounding — a bar is stamped by its **open** time, so rounding
up would move it into the next period and rewrite history.

**One correction to the issue's own recommendation, with evidence.** The issue proposed
flooring `1d` to **21:00 UTC**. That is wrong for every non-mt5 provider, and I proved it
twice against live data:

| Attempt | Rule | Result on healthy data |
|---|---|---|
| 1 | `1d` = 21:00 UTC | FAILS — binance uses `00:00`, yahoo uses `07:00` |
| 2 | per-provider table | FAILS — yahoo legitimately uses **three** boundaries (`07:00`, `13:30`, `00:00`) across its symbols, because it serves several exchanges |
| **3 (shipped)** | **per SERIES**, one boundary; provider default = mt5 21:00 | PASSES mt5/binance/yahoo as they actually are |

The daily close is a property of the **market**, not the provider and not UTC. The same
relativity applies to `4h`, which mt5 stamps at `01/05/09/13/17/21` — a +1h broker offset,
**not** a clean UTC grid. Judging `4h` by `hour % 4 === 0` false-positived on 12 healthy
rows before I corrected it.

- [x] **2. A test feeds an unaligned duplicate at `13:30` for an existing `13:00` `1h` bar and asserts one row remains in `marketbar`.**

`nest/src/common/utils/import-bars-alignment.spec.ts` → _"keeps ONE row when an unaligned
duplicate is imported"_. Runs against real Prisma and asserts `toHaveLength(1)` plus the
surviving timestamp. Also covers the **null-coercion trap** below.

⚠️ This needed a genuine integration test, not a unit test: the defect was never arithmetic,
it was that the unique key could not fire because the timestamps genuinely differed.
Rejection is the **database's** job, so a pure-function test cannot demonstrate it.

- [x] **3. A test asserts every `1h`/`4h`/`1d` row has exactly one valid minute-offset for its timeframe.**

Same spec, criterion-3 test: seeds jittered misaligned inputs across `1h`/`4h`/`15m`/`5m`,
then asserts every stored row's offset-from-boundary collapses to exactly `[0]`.

- [x] **4. Post-cleanup, `SELECT timeframe, MINUTE(timestamp) m, COUNT(*) ... GROUP BY timeframe, m` shows one offset for `1h`, `4h` and `1d`.**

Same spec, criterion-4 test, asserted against the live table: `1h` and `4h` each yield
offsets `[0]`, and no `1d` series holds more than one boundary.

The purge itself removed **11,438 rows** (249,136 → 237,698):

| Target | Rows | Rule |
|---|---|---|
| `1h` off the hour | 5,834 | certain — an hourly bar cannot sit on `:30` |
| `4h` off the hour | 4,348 | certain |
| `1d` non-dominant offset | 1,256 | mt5 `21:30` cohort |

⚠️ The `1d` rule had to be the **provider-wide dominant** boundary, not a per-series
majority. A majority vote silently kept 805 rows because in 19 series the phantom
*outnumbered* the real bar (EURUSD: 200 × `21:30` against fewer `21:00`). Measured
authority: mt5 `21:00` = 3,689 bars / 86 symbols vs `21:30` = 805 / 19.

All 11,438 row ids were snapshotted before deletion and are stored **outside the repo** at
`backups/issue-783-purge/bar-783-purge-backup.csv` on Google Drive, so the purge is
reversible.

- [x] **5. `computeMarketStatus()` on XAUUSD `1d` reports a daily cadence, not 30m.**

The decisive metric, measured before and after:

| timeframe | median before | median after | expected |
|---|---|---|---|
| `1h` | 30m | **60m** | 60m ✅ |
| `4h` | 30m | **240m** | 240m ✅ |
| `1d` | **30m** | **1440m** | 1440m ✅ |

The fake 30-minute cadence on a *daily* series is gone — that was the actual corruption,
since `effectiveCadenceMs` feeds the staleness window for every multi-hour protocol.

---

### New invariant — `INV-BAR-ALIGNED`

The issue observed that every existing bar invariant is a **marker-presence canary**:
`INV-BAR-ORDER` only asserts `normalizeDirectiveBars`/`bars.sort(` **exist**, and
`INV-SINGLE-CADENCE` only asserts `selectBaseTimeframe` exists. None can see that the rows
themselves are wrong — which is why this survived undetected.

`INV-BAR-ALIGNED` is the **first bar invariant that inspects data**. Registered in the
contracts doc, the validator's `PROBE_ENFORCED` map, and the QA checklist (`qa-contract-021`).

**Proven both ways**, because a guard that cannot fail is worthless and one that fires on
correct code gets switched off:

- healthy data → `PASS` (checked 60 rows, all on valid boundaries)
- `--aligned-since 2026-08-01` → `FAIL`, locating all 10,106 pre-fix phantoms

It judges only rows newer than `ALIGNED_SINCE` (default `2026-09-11`). A permanently-red
guard is one nobody reads, so purged history is excluded and the check means *"no NEW
misaligned bar"* — the property that can actually regress.

### A bug in my own first draft, caught by my own test

`new Date(null).getTime()` is **`0`, not `NaN`**, so a naive `Number.isNaN` check let
`null` / `false` / `[]` through and they became **1970-01-01** — a bar dated 1970 that looks
like real data, which is exactly the failure mode this issue is about. The guard now rejects
null-ish and non-scalar input explicitly and reports `invalid`, and both the unit spec and
the integration spec pin it.

### Verification summary

| Check | Result |
|---|---|
| Test suite | **399/399 pass, 58 suites** (36 new) |
| Build gate | 21 invariants, **0 deviations**, QA mirror satisfied |
| Live probe | `INV-BAR-ALIGNED` PASS on healthy data, FAIL on pre-fix history |
| Live E2E | duplicate rejected, malformed rejected, real bar stored |
| Cadence | `1h`=60m, `4h`=240m, `1d`=1440m (all were 30m) |

### Not done

The 29 non-identical mt5 pairs (same OHLC, later close/volume — a mid-update re-snapshot)
resolved as duplicates through alignment, so they needed no separate handling. Periods where
the back-fill wrote a phantom but **no** real bar remain genuine gaps; re-import is the
cheaper repair than back-filling, per the pre-release policy in
`development-status.instructions.md`.

Closing — all five criteria verified.
