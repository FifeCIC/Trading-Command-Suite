## 🎯 The shadow has run — and it answers the question the issue was opened with

Deployed 2026-10-07 (`shadow-supertrend.js` in `dist`, API serving 0.118.0). First evidence, from
**27 `DECLINED` lines** in `nest/logs/tcs-2026-10-07.log` — the shadow field is being written, and it
**disagrees with the incumbent**.

### A worked example, verbatim

```
DECLINED GER40 broker=3 ticket=93621464 side=BUY outcome=below-threshold consensus=0
  aligned=[chandelier-exit:55]
  opposing=[supertrend:55]
  neutral=[atr-trailing-stop,wick-filter]
  shadow=[supertrend:bullish]
```

The incumbent calls **bearish** (opposing the BUY). The shadow calls **bullish** (aligned). With the
shadow in place that position reads `aligned = 2, opposing = 0` — and under
`consensus = avg(aligned) − avg(opposing)` that is **55**, which **clears the `>= 55` gate**.

### The measurement

| Measure | Value |
|---|---|
| `DECLINED` lines carrying the shadow field | **27** |
| incumbent `supertrend` **opposing** | **25** (93%) |
| **incumbent opposes but the shadow says bullish** | **11** |
| **would reach `consensus >= 55` with the shadow** | **7** |
| positions the guardian actually adjusted (same window) | **0** |

⚠️ **26% of declines would have crossed the gate.** The guardian is not inert because the market is
quiet — it is inert because the input it is judging on is not a trend.

### Side breakdown (the flip is not an artefact of one direction)

| Position side | Shadow says | Count |
|---|---|---|
| BUY | `bearish` | 14 |
| BUY | `bullish` | 10 |
| SELL | `bullish` | 3 |

The BUY rows split — the shadow is discriminating, not defaulting.

## What this does and does NOT establish

✅ **Establishes:** with a canonical ratcheting SuperTrend in place of the midpoint test, the guardian
would have acted on ~1 decline in 4 instead of none.

⚠️ **Does NOT establish:**
- **That acting would have been RIGHT.** No outcome was measured — nothing followed those 7 positions to
  see whether a wider/tighter stop helped. The shadow says *"the gate would open"*, not *"the gate should
  have opened."*
- **Which of the two is correct on any individual row.** This shows they disagree; it does not adjudicate.
- **That the 25-of-27 opposing rate is the indicator alone.** A book of underwater positions biases a
  one-bar test toward "opposing" — that was flagged when the issue was raised and **remains unisolated**.

## Consequence for #965 P0/P1

Nothing here changes the sprint order. The shadow is **evidence for a decision**, not a licence to edit
`SuperTrendDirective` — replacing it still changes when a live stop moves, which is exit-path maths.
What it changes is that the decision now has a measured basis, and the remaining work is to measure
**outcomes**, not agreement.
