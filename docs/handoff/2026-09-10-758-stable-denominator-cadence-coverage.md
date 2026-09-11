---
date: 2026-09-10
area: market-data
type: bugfix
issues: [758]
invariants: [INV-CADENCE-COVERAGE]
---

# #758 closed — stable denominator, phantom zeros eliminated, and two deeper faults found

## What Changed

Closed **#758**. All three reported defects verified fixed, plus the `stalled` state it
recommended. Fixing it exposed **two further faults** that were causing the same symptom —
protocols that report `scoring` while producing nothing — and both are now fixed.

Outcome: **16 active protocols → 11 `scoring`, 5 honest `no-data`, 0 `stalled`** (was 7 stalled
for 357 minutes).

## Why This Existed — three layers of the same silent failure

Each layer hid behind an *empty result being a legitimate state*. A new symbol genuinely has no
history; a genuine neutral reading genuinely scores 0. So every one of these faults produced no
error, and each one looked exactly like a working system that happened to have nothing to say.

### Layer 1 — the denominator was still market-dependent after the first fix

The first fix added `configuredSignalMax`, but it **still consulted the runtime
`result.signalClass`** when accumulating capacity:

```ts
} else if (directionMode === 'LONG_ONLY' && result.signalClass !== 'bearish') {
  capacityMax += maxScore;   // ← depends on what fired this tick
}
```

Measured live after that fix deployed: `forex-session-v1` wrote **FIVE different denominators in
30 minutes** (470/560/390/480/410). It also made capacity depend on the **symbol**, since each
symbol reaches a different directional reading — so one protocol scored two symbols against two
different maxima in the same tick.

Fixed by making direction-eligibility a property of the **config**, not the tick: any non-gate
directive admitted into the protocol counts toward capacity. Whether it reads neutral or bullish
*this* minute now moves the numerator only. This is literally what the issue's own analysis
recommended — *"Denominator = sum of maxScores of all included, direction-eligible directives
from config, not from what fired."*

**Verified:** `COUNT(DISTINCT configuredSignalMax)` = **1 for all 15 protocols**, across
multiple symbols and many ticks. Was up to 5.

### Layer 2 — `INV-CADENCE-COVERAGE`: nothing fetched the cadence protocols asked for

Seven protocols declare `recommendedTimeframe = '5s–30s'`, which `selectBaseTimeframe()`
resolves to **`1m`**. `BarRefreshService.TIMEFRAMES` was `['5m','15m','1h','4h','1d']` — **`1m`
was never fetched, and the DB held ZERO `1m` bars.**

They asked the canonical loader for a cadence that did not exist, received an empty array, and
produced nothing. The two lists live in different files and **nothing tied them together** —
that gap was the defect, not either list.

Fixed: `1m` added, and a new build-time guard (`timeframe-refresh-coverage`) asserts the fetched
set is a **superset** of every cadence `selectBaseTimeframe()` can return. Either list changing
alone now fails the build.

**Verified:** `1m` bars went **0 → 4,081** across 21 symbols; **14 of 15 protocols flipped from
`stalled` to `scoring`** within minutes.

### Layer 3 — registry tickers the provider cannot fetch

`SPX500`, `TECH100`, `DJI30` and `USOIL` had **zero bars, ever**. They are not the provider's
names for those instruments. Four ACTIVE protocols depended on them and could not score at all:
`spy-day-v1`, `spy-speed-v1`, `qqq-day-v1`, `qqq-speed-v1`.

**Applied** (`nest/fix-symbol-tickers.sql`, a recorded migration):

| Was | Now | Unblocks |
|---|---|---|
| `SPX500` | `US500` | spy-day-v1, spy-speed-v1 |
| `TECH100` | `USTEC` | qqq-day-v1, qqq-speed-v1 |
| `USOIL` | `WTI` | oil-speed-v1 (inactive) |

**Verified:** `US500` → 1,202 bars / 6 timeframes, `USTEC` → 1,776 bars / 6 timeframes, both
live to 14:08. `DJI30 → US30` was **deliberately not applied** — a `US30` row already exists
(mt5-sourced, 1,400 bars, stale since 2026-07-24), so that pair needs a **merge decision**
(which row survives; what happens to the other's bars and assignments), not a rename.

## Findings corrected mid-investigation — worth recording

I initially reported VIX, UKOIL and NATGAS as un-tradeable because MT5 does not offer them.
**That was wrong for VIX** and I corrected it before acting. VIX is live with 5,674 bars updating
to 14:01.

The mistake is instructive: I probed availability with `/quote?symbol=VIX`, which 404s for
symbols that fetch fine via `/candles`, and I cross-checked against `/symbols`. **A probe that
404s is not evidence of absence** — a route mismatch produces the same response as a genuine
gap. The accurate test was the `marketbar.provider` column plus bar freshness, which reflects
what actually happened rather than what one endpoint answers.

Also: `exchange = 'Xtrend'` on 21 symbols is a **vestigial label** — there is no Xtrend adapter.
Delivery is MT5, and `BTCUSD`/`BTC-USD`/`DOGEUSD` are actually `binance`-sourced and stale
because `BarRefreshService` only ever calls `adapterFactory.create('mt5')`.

## The Theory — "empty" is the most dangerous valid state

The unifying principle across all three layers: **an empty result is indistinguishable from a
correct result that happens to be empty**, so no check fires and no log line is written. Every
guard that would have caught these had to compare two things that were never compared:

- the configured denominator vs the observed one
- the cadences that *can* resolve vs the ones actually *fetched*
- the tickers in the registry vs the tickers the provider *serves*

None of those pairs had a check, because each half lived in a different file and both halves
looked individually correct. The lesson is to look for the **sibling list** — whenever a value
is produced by one module and consumed by another, something should assert they still agree.

## Files Changed

- `nest/src/modules/scoring/protocol-gating.service.ts` — capacity from config, not runtime.
- `nest/src/modules/market-data/bar-refresh.service.ts` — `1m` added to TIMEFRAMES; explainer
  noting every resolvable cadence must be fetchable.
- `nest/scripts/validate-pipeline-contracts.cjs` — `checkTimeframeCoverage()` +
  `timeframe-refresh-coverage` rule (15 invariants total).
- `.github/instructions/meta-stack-contracts.instructions.md` — `INV-CADENCE-COVERAGE`.
- `src/data/qa-checklist.js` — `qa-contract-016`.
- `nest/fix-symbol-tickers.sql` — **NEW**, the applied ticker migration.
- `docs/symbol-data-coverage-audit.md` — **NEW**, full provider/freshness audit.

## Verification

- 262 tests / 46 suites pass; backend + frontend builds clean; contract gate green at 15
  invariants.
- New guard proven by injection: removing `1m` from `TIMEFRAMES` fails the build naming the
  exact cadence.
- Live: denominator stable (1 distinct value × 15 protocols), 0 phantom zeros, 0 missing
  `rawMax`, 14/15 protocols recovered, `US500`/`USTEC` streaming.

## Still Needs a Decision — not taken by an agent

1. **`DJI30` vs `US30` merge** — two rows for one instrument, the existing one stale 47 days.
2. **Crypto data path** — `BTCUSD`/`BTC-USD`/`DOGEUSD` are `binance`-sourced, 16–54 days stale,
   and nothing refreshes them because the refresh loop is MT5-only. Route them through the
   binance adapter, or retire the crypto protocols.
3. **The stale `US30`** — the only MT5 symbol that was fetching and then stopped. Different
   symptom from the ticker mismatch; worth its own look.
4. **`UKOIL` / `NATGAS`** — genuinely absent from MT5. `oil-speed-v1` can only run on `WTI`.
