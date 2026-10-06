## Summary

`supertrend` claims *"ATR(10) × 3 multiplier trailing stop. Price above upper band = strong uptrend; below lower band = strong downtrend."* It computes those bands from **the last bar's own high/low**, so they are not bands and there is no trend memory. The directive degenerates into a coin flip on whether the close sits above its own bar's midpoint — a **sub-pip** comparison — and returns ±55 from it.

It is one of the **two** directives that ever contribute directional evidence to the stop guardian's `>= 55` consensus.

---

## Measured

### 1. The bands are built from ONE bar

```js
const lastHigh = highs[highs.length - 1];
const lastLow  = lows[lows.length - 1];
const midline     = (lastHigh + lastLow) / 2;        // ← this bar's midpoint
const basicUpper  = midline + multiplier * lastATR;  // ← this bar ± 3×ATR
const basicLower  = midline - multiplier * lastATR;
```

A real SuperTrend ratchets a band forward across bars and only changes direction when price **closes through** it. Here both bands are recomputed from the same single bar every time, so the "trailing stop" has no state at all.

### 2. The two "strong" branches are effectively unreachable

Real 5m bars, computed with the directive's own formulas (`atr` period 10, multiplier 3):

| Symbol | `lastClose` | `midline` | `atr10` | `basicUpper` | `basicLower` |
|---|---|---|---|---|---|
| XAUUSD | 4169.30 | 4168.38 | 2.307 | **4175.30** | 4161.46 |
| EURUSD | 1.1260 | 1.1260 | 0.0002 | 1.1268 | 1.1253 |
| US30 | 51587.2 | 51586.4 | 9.38 | **51614.54** | 51558.26 |

For XAUUSD the bullish-strong branch needs `close > 4175.30` while the bar's own high is ~4170 — `midline + 3×ATR` exceeds the bar's high whenever `ATR > range/6`, which is the normal case. **So `score 75` never fires**; the only live outcomes are:

| Branch | Condition | Result |
|---|---|---|
| moderate bullish | `close > midpoint` | score 55, `bullish` |
| *(fall-through)* | `close <= midpoint` | score 55, `bearish` |

**±55 decided by 0.92 on XAUUSD and 0.8 on US30** — a fraction of a pip, with no trend information in it.

### 3. Corroboration on the live exit path

142 `DECLINED` lines in `nest/logs/tcs-2026-10-06.log`, the guardian's own recorded breakdown:

| Directive | Aligned | Opposing |
|---|---|---|
| `supertrend` | **11** | **131** |
| `chandelier-exit` | 57 | 43 |

⚠️ **I am NOT claiming `supertrend` is inverted.** A single-bar close-vs-midpoint test genuinely *would* favour "opposing" on a book of positions that are mostly underwater — the 92% is consistent with both a broken indicator and a losing book, and **I have not isolated which**. What the numbers above establish is the defect itself: the quantity being tested is not a trend.

---

## Impact

`stopConfidence = avg(aligned) − avg(opposing)`, and every contributing score is 55. So the consensus can only be **0 or 55**, and 55 requires *at least one aligned directive and no opposing one*. With `atr-trailing-stop` permanently unable to fire (#1075) and `supertrend` emitting a midpoint coin flip, the guardian adjusted **0 positions** across a full day (132 of 133 declines at `consensus=0`).

`supertrend` references **0 protocols** (`protocol_directive_entry` ⋈ `protocol_directive_group` ⋈ `protocol`), so the blast radius is the **exit path only** — it is not in any scoring composite.

## ⚠️ This is a maths decision — options, with costs

Reimplementing the indicator changes when the guardian moves a live stop. Per `maths-change-requires-ab`, that needs a copied configuration and a monitored comparison, not an in-place edit.

| Option | Pros | Cons | Effort |
|---|---|---|---|
| 🟢 **A — SHADOW it first (no behaviour change)** — compute a canonical ratcheting SuperTrend from the same 30 bars each pass and append its direction to the `DECLINED` line | Changes nothing; accumulates real evidence on whether a working indicator would actually clear `>= 55`; can be reverted by deleting one log field | Adds a second indicator implementation that must be labelled **shadow-only** so nobody acts on it; the log line grows | Small |
| **B — fix the band construction in place** (ratchet a real band across bars) | Restores the declared intent; guard begins acting on real trend | Changes live exit behaviour immediately, unmeasured; reimplementation, not a value restoration | Medium |
| **C — remove `supertrend` from `STOP_GUARDIAN_DIRECTIVES`** | Honest: the threshold then matches the evidence base it really has | Loses an input; the `>= 55` calibration still needs revisiting | Small |
| **D — leave it** | Zero risk | A directive that does not do what it says stays in the exit path; `atr-trailing-stop` is now reported hourly (#1075) but this one looks healthy because it returns non-constant scores | None |

**Recommendation: A**, then decide from the evidence. Nothing here is acted on without that.

## Not established

- Whether the corrected indicator would change any actual decision — **unmeasured**, and that is what option A is for.
- Whether the 131/142 opposing skew is the indicator or the position book — **not isolated**.
- `directive-guard.cjs` does **not** flag this: MODE 1 saw only "identical output for two different inputs (score=55)" (a constant-output *suspicion*) plus MODE 5 was silent, because the declared `directionBias` does match the emitted classes. The guard's synthetic fixture is a strong trend whose `midline` comparison happens to land the same way on both inputs.
