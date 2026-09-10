# One denominator: `#758` completed for the classification percentage

**Date:** 2026-09-10
**Version:** 0.6.5 → 0.6.6
**Issue:** #758 (was closed prematurely — completed here)

## The reported symptom

A card on `/scoring/live-ordering-stack` read:

```
#2  XAUUSD  Gold Swing 1H  ▲ STRONG_BUY  Live  Signal 152 / 910  17%  Opp 589
```

`STRONG_BUY` at **17%**. The user's question: *"as if the signal score doesn't
actually matter."* It did matter — it was being divided by a different number.

## Root cause — `#758` was half-applied

`#758` established `configuredSignalMax` (the protocol's configured directional
capacity) as the stable denominator, and used it for the **persisted `rawMax`**.
But it left the **classification percentage** on the observed denominator:

```ts
const signalDenominator = capacityMaxTotal > 0 ? capacityMaxTotal : totalMax;  // built...
const signalPct = selectedEvidence.percentage;                                // ...never used
```

`signalDenominator` was **declared and never referenced** — verified by grep
(single occurrence). So one reading carried two percentages:

| Question answered | Denominator | `xau-speed-1h` |
|---|---|---|
| Card's displayed `%` | `configuredSignalMax` = 910 | **17%** |
| `BUY/HOLD/SELL` label + pre-trade gate | `observedSignalMax` = 185 | **82%** → `STRONG_BUY` |

Both were arithmetically correct; they answered against different bars.

### Why the observed sum is not a legitimate denominator

`observedSignalMax` sums only the directives that read **directional this tick**,
so it **shrinks when a directive reads neutral** — a *quieter* tick produces a
*higher* percentage. For `xau-speed-1h` this tick, only `sentiment` (100 of 190)
and `technical` (85 of 605) read directional, so a protocol with 910 points of
capacity was being judged out of 185. `gold-session-profile` reading neutral
inflated the score by removing itself from the denominator.

`#758`'s own closing comment proves the intent — it quotes the issue's
recommendation *"Denominator = sum of maxScores of all included, direction-eligible
directives from config, not from what fired"* and verified
`COUNT(DISTINCT configuredSignalMax) = 1 for all 15 active protocols`. The
config-based denominator was built correctly; it was simply never wired to the
label.

## A third convention

`arena.controller.ts` **re-derived its own denominator**:

```ts
const rawMax = Object.values(gated.subMaxTotals || {}).reduce(...)   // OBSERVED
```

— the exact recomputation `protocol-gating.service.ts:1242` warns against. So the
Arena disagreed with the card for the same reading. It coincidentally matched
classification, which made it look consistent while being an independent bug.

## Fix

1. **`signalPct` now divides by `signalDenominator`** — the configured capacity.
   One number drives the label, the displayed percentage, and the gate, so they
   cannot disagree.
2. **`signalMax` (top level) and `meta.maxScore` now carry `signalDenominator`.**
   Both previously carried the observed `totalMax`, so any consumer recomputing
   `raw / maxScore` got a *third* answer. `signalRaw / signalMax === signalPct` is
   now an identity.
3. **Arena uses `gated.signalMax`** instead of re-deriving from `subMaxTotals`.
4. **`signalDenominator` is live code**, not dead.
5. Comments corrected: the old ones claimed `signalPct` was config-based (it
   wasn't) and that `observedSignalMax` was "diagnostic only — do not divide by
   it" (which `signalPct` did). The type docs now state the rule that is enforced.

## Verified

Live `GET /api/scoring/gated/XAUUSD?protocol=xau-speed-1h&timeframe=1h&bars=200`:

| Field | Value |
|---|---|
| `signal` | `HOLD` |
| `signalPct` | `16.7032967032967` |
| `signalRaw / signalMax` | `152 / 910` = `16.7%` |
| `meta.maxScore` | `910` |
| `meta.observedSignalMax` | `185` (diagnostic only) |

`signalPct` == `signalRaw/signalMax` == `meta.compositePct`, and the label is
`HOLD` — consistent. Nest build exit 0, contract gate ✅ 12 invariants.

## ⚠️ The consequence you need to decide on — thresholds are now mis-scaled

`STRONG_PCT = 80` and `ENTRY_THRESHOLD = 40` were **calibrated against the
observed denominator**. On the configured denominator nothing reaches them:

| Protocol | Best % seen |
|---|---|
| `gold-macro-v1` | 21 |
| `xau-speed-1h` | 15 |
| `forex-session-v1` | 14 |
| `spy-speed-v1` | 3 |
| **Maximum recorded anywhere, last 3 hours** | **32** |

Consequences now that the denominator is correct:

- **`STRONG_BUY` / `STRONG_SELL` (≥80%) is unreachable.** No row has ever recorded
  above 32%.
- **`ENTRY_THRESHOLD = 40` is effectively unreachable**, so almost everything
  classifies as `HOLD`.
- The pre-trade gate (`signal-envelope.service.ts:694`, `signalPct < 65`) is now
  **stricter by ~5×** — the same market condition that previously passed at 82%
  now reads 16.7% and is blocked.

This is not a regression introduced here; it is the previously-hidden
consequence of the two denominators, now visible. The thresholds were only ever
"working" because the observed denominator inflated the numerator side.

**Deliberately NOT changed.** Recalibrating 80/40/65 is a scoring-semantics
decision (what counts as a strong buy) and belongs in its own change with its own
evidence — `#758`'s scope was the denominator, not the bands. Recommend a
follow-up issue that sets thresholds against the configured scale using the real
distribution above.

## Theory worth keeping

**A percentage is meaningless without its denominator, and a threshold is
meaningless without the scale it was calibrated on.** Fixing a denominator
silently recalibrates every threshold that divides by it. When you change what a
denominator *is*, enumerate the thresholds — not just the display.

**Dead code is a signal, not clutter.** `signalDenominator` being unused was the
tell that the `#758` change was incomplete. A variable computed and never read is
usually a half-finished wiring, not a leftover. It had been sitting 21 lines above
the line that should have used it.
