# Adaptive Target — the realistic ceiling, off by default

**Date:** 2026-09-10
**Version:** 0.6.6 → 0.6.7
**Issue:** #685 (Signal % ceilings) — this implements the mechanism; #761 still owns the threshold bands

## The problem

A protocol's percentage is `raw / configuredSignalMax`, where `configuredSignalMax` is the
sum of **every** direction-eligible directive's `maxScore` — the score if everything fired
at full. That never happens, and not because the market is quiet: directives are
**mutually exclusive by design**. `rsi-oversold` and `rsi-overbought` cannot both peak;
`session-open-effect` is zero outside its 30-minute window.

So a protocol with 910 points of capacity where perhaps 200 can plausibly fire on one bar
reads ~20% on its best day. Measured across the live registry, the **maximum ever recorded
was 32%** (#761). `configuredSignalMax` therefore answers "how does this compare to a total
this protocol can never reach" — not the question a trader is asking.

## The mechanism

Record the protocol's own **observed peak** raw composite. When an operator opts in
per protocol, percentages divide by that peak instead of configured capacity, so the number
reads "how good is this **for this protocol**".

### ⚠️ Monotonic — the peak only ever rises

This is the design's load-bearing property. The obvious alternatives are all wrong:

| Rejected | Why it fails |
|---|---|
| Rolling N-day window that can fall | A quiet spell permanently lowers the bar |
| "Recent typical high" (percentile), re-based monthly | Same problem, slower |
| Decay toward recent observations | Same problem, continuous |

**Every one lets a quiet period silently lower what counts as good.** If `stochastic`
quietly stops working, a falling target lowers the bar to match and the card still reads
healthy — the fault appears nowhere. This repo has hit that failure class repeatedly
(`meta-stack-contracts.instructions.md`: *"plausible numbers with no error"*).

A high-water mark is the only self-calibration that **cannot hide decay**.

### Bounded

- **Floor: 25% of configured capacity.** A protocol that has only ever peaked near zero
  (`spy-speed-v1` peaked at ~3%) must not be "normalised" into looking healthy.
  Verified live: `xau-speed-1h` peak `92` against configured `1150` would otherwise give
  `92/92 = 100%`. The floor sets the denominator to `287.5`, so it reads **32%** and stays
  visibly weak.
- **Ceiling: configured capacity.** A peak above capacity would be a denominator bug.

### Sample floor

Minimum **20 observations** before the target is trusted. Below that one lucky tick would
define the protocol's whole scale. The API **refuses to enable** below the floor rather
than letting an operator toggle it on and see no change:

```
400 Cannot enable Adaptive Target for xau-speed-1h: it needs at least 20 scoring
    observations before a peak is meaningful (currently 4).
```

### Observation uses the PRE-GATE raw composite

Not the gated `composite`. A closed market hard-gates the composite to 0, so feeding it
would make the peak depend on whether the market happened to be open — reintroducing the
tick-varying denominator `#758` removed. Same value that is persisted as
`breakdown.rawComposite`, read through one shared helper so the two cannot drift.

## Storage

| Column | Type | Purpose |
|---|---|---|
| `adaptiveTargetEnabled` | Boolean, default **false** | opt-in per protocol |
| `adaptiveTargetMax` | Float? | observed peak raw composite |
| `adaptiveTargetSamples` | Int | readings contributing |
| `adaptiveTargetSince` | DateTime? | when the peak was first set |

⚠️ **Added via targeted `ALTER TABLE`, not `prisma db push`.** `db push` proposed dropping
12 populated tables/columns — including `signal_outcome_log` (1,370 rows),
`marketbar_ts_backup_20260910` (195,391 rows) and the other timestamp-repair backups
another agent created today. `db push` is **not safe in this repo while the schema has
drifted from migrations**; the push was cancelled (`DBPUSH=130`) and the columns added
directly. `prisma generate` was run so the client knows the fields.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/scoring/protocols/:slug/adaptive-target` | state + both denominators + `reasonText` |
| `PATCH /api/scoring/protocols/:slug/adaptive-target` | `{ enabled: boolean }`, guarded |
| `GET /api/scoring/gated/protocols` | now carries `adaptiveTargetActive` so the Ladder badges cards with **no extra request** |

`adaptiveTargetActive` is the question the UI actually asks — enabled **AND** enough
samples to change the denominator. A flag-on-but-too-few-readings protocol is **not**
badged, because its scores are still on the configured scale and a badge would be a lie.

## UI

1. **Registry toggle** beside Active/Inactive (`/protocols/protocols-registry`).
   Named **"Adaptive Target"** — "target" is the thing measured *against*, not an action
   on the score. "Smart"/"Learning" rejected as overclaim: it remembers, it does not learn.
   "Ceiling" rejected because the docs already use that word for a protocol's structural max.
2. **Deliberately a different colour from Active/Inactive** — amber for on, dashed when off.
   Active/Inactive decides whether the protocol *runs*; Adaptive Target decides what its
   scores are *measured against*. Confusing those two would be dangerous.
3. **Explanation panel** whenever it is on (or when enabling was refused), stating both
   numbers, the sample count, and when the peak was set.
4. **Ladder card badge** — a `TARGET` chip on any card whose percentage is on the adaptive
   scale, with a tooltip naming both denominators. This is the requirement "make it clear a
   protocol has the new system applied": the whole risk of this feature is a reader
   comparing two percentages that sit on different scales without knowing.
   The badge carries a **word**, not just a colour, so it survives colour-blind rendering.

## Verification (live)

| Test | Result |
|---|---|
| Default state | `enabled: false`, denominator = configured ✅ |
| Observation running | 10 protocols recording peaks, all `en=0` ✅ |
| Enable below sample floor | `400` with self-explaining message ✅ |
| Enable with enough samples | `applied: true`, denominator `287.5` ✅ |
| Disable | reverts to `1150`, `applied: false` ✅ |
| Floor prevents promotion | peak 92 / floor 287.5 = **32%**, not 100% ✅ |
| Ladder badge | **exactly 1** card badged, correct protocol, none other ✅ |
| Spec | 14 tests pass, incl. explicit monotonicity assertions ✅ |
| Builds | nest 0, vite 0; contract gate 12 invariants ✅ |

## Theory worth keeping

**A ceiling must not adapt to the thing it is measuring.** An adaptive target sounds
sophisticated but it is a mirror: it would report the recent past back as the standard.
The only useful self-calibration is a high-water mark, because it can only ever raise the
bar — and a bar that cannot fall is the only one that can reveal decay.

**A feature that changes a scale must be visible on every surface that shows the number.**
The registry toggle alone would have been insufficient: the Ladder is where the percentages
are actually read and compared. Hence the card badge.

## Outstanding

- **#761** — the 80/40 thresholds are still calibrated against the old, inflated
  denominator. Enabling Adaptive Target raises percentages, which interacts with that
  recalibration: decide the bands **before** rolling this on, or the two changes will
  confound each other.
- Only `xau-speed-1h` was toggled during testing and has been set back to off. All other
  protocols are observing but disabled — intended.
