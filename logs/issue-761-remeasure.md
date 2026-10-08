## Re-measured 2026-10-07 — the thresholds in this issue's table are STALE. They are **6** and **13**, not 40 and 80.

⚠️ **A number carried in an issue body is still a claim.** This one is no longer true, and it is the kind that
sends a reader to "fix" a value that was fixed three weeks ago.

### What the code actually declares

`nest/src/modules/scoring/protocol-gating.service.ts`:

```ts
const ENTRY_THRESHOLD = 6;   // % of maxScore — BUY/SELL above this; below = HOLD
export const STRONG_PCT = 13;

export const SIGNAL_THRESHOLDS = { entry: ENTRY_THRESHOLD, strong: STRONG_PCT, scale: '…' } as const;
```

The block above them records the change and its reasoning, and cites **this issue by name**:

> ⚠️ **RESCALED 2026-09-15 — 40 → 6, 80 → 13.** … ADR-011 (#758, second pass) changed the percentage
> DENOMINATOR from the OBSERVED directional sum (~130) to the CONFIGURED directional capacity (~725-815) —
> about 6.3x larger — which divided every percentage by that factor. … **Every value is the old one divided by
> ~6.3, rounded, ordering preserved — a units migration, not a tuning decision.**
> … `SIGNAL_THRESHOLDS` … *"so the Settings page renders the live values and cannot show a stale copy
> **(#761 follow-up)**."*

So both halves of this issue are addressed:

| This issue asked | Status |
|---|---|
| Thresholds were calibrated against the old inflated denominator | ✅ **rescaled 40 → 6, 80 → 13**, ordering preserved |
| `STRONG_PCT` 80 "unreachable — no row above 32%" | ✅ `STRONG_PCT` is **13**; against a measured best-ever of 32% it is now reachable |
| A stale hand-copied threshold somewhere | ✅ `SIGNAL_THRESHOLDS` is the single exported source, with the scale named |

### And the ceiling has moved, independently

The sibling issue **#999** was re-measured today: `xau-speed-m15`'s reachable directional capacity is
**380 of 910 (41.8%)**, not the 145 (15.9%) it recorded on 2026-09-25 — because `rsi-oversold` (140) and
`support-resistance-levels` (95) now emit directional classes where both were previously neutral-only.

**41.8% reachable against `STRONG_PCT` 13 is a very different picture from 15.9% against 80.** The two
issues agreed on the wall; the wall has since moved below the bar.

### ⚠️ What this does NOT claim

**None of this says the thresholds are now RIGHT.** The rescale was explicitly *"a units migration, not a
tuning decision"*, and the same block is blunt about the consequence:

> ⚠️ **MAKING THE APP TRADE IS NOT MAKING IT PROFITABLE.** Measured directional accuracy was 39–48% …
> at or below chance. These bars exist so the pipeline PRODUCES TRADES TO BE MEASURED (#817). **Tune from
> outcomes.**

So whether 6 / 13 are the *profitable* values is an open question owned by **#817** (does any protocol beat
drift?) and the theory registry — and changing them now would be a maths edit without an A/B, which
`maths-change-requires-ab` forbids. **Recorded here so the next reader does not re-derive the old table.**

⚠️ Left OPEN deliberately: I have not walked this issue's remaining acceptance items, and closing it on a
re-measurement of one table would be the "ticked without checking" defect the close checklist exists to stop.
