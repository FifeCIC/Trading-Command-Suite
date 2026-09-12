---
date: 2026-09-12
area: scoring
type: analysis
---

# ANALYSIS — Does the directive/score system show predictive content? (measured, not asserted)

> **Trigger:** the owner asked whether there is a flaw in scoring, or whether mixing directives
> together simply does not work, and stated they will pause development unless a change will
> positively affect profitable trading. **This file is the measurement that answers that.**

## What Changed

**Nothing.** No code, no schema, no config. This is a read-only analysis of existing
`directiveoutcome` data. It is recorded because the numbers are the most important thing
discovered about this project so far, and because they must not be re-derived from scratch.

## Method

Read-only aggregate queries against `directiveoutcome` (matured rows only,
`outcomeComputedAt IS NOT NULL AND directionCorrect IS NOT NULL`), joined conceptually to the
`signalClass` and `score` recorded at prediction time. `directionCorrect` is resolved by the
existing `OutcomeTrackerService` maturation sweep against `priceT15m/1h/4h/24h`.

## Data volume (read this FIRST — it bounds every conclusion below)

| Metric | Value |
|---|---|
| `directiveoutcome` rows (total) | 13,494 |
| **matured** | **12,172** |
| with `directionCorrect` resolved | 10,920 |
| horizon coverage | `t15m` 11,298 · `t1h` 10,484 · `t4h` 9,956 · `t24h` 8,288 |
| **distinct symbols** | **18** |
| **distinct directives** | **18** |
| **distinct DAYS** | **4** ⚠️ |

**⚠️ FOUR DAYS OF DATA.** Row count is not sample size. Every finding below is a 4-day
observation, and the per-symbol spread (below) demonstrates the instability directly.

## Finding 1 — score does NOT rise monotonically with correctness (both classes pooled)

| Score band | n | Hit rate |
|---|---|---|
| <20 | 4,017 | 50.2% |
| 20–40 | 4,441 | 50.2% |
| 40–60 | 327 | 38.8% |
| 60–80 | 1,337 | 38.2% |
| 80–100 | 241 | 64.7% |
| ≥100 | 121 | 27.3% |

Pooled, higher conviction is *not* more accurate — it inverts above 40. **But this pooled view
is confounded** (see Finding 3), so it must not be read as "scoring is broken".

## Finding 2 — split by direction, the picture is opposite for each

**BEARISH — monotonic and strong. This is real signal:**

| Band | n | Hit |
|---|---|---|
| <20 | 3,767 | 51.6% |
| 20–40 | 3,108 | 52.3% |
| 40–60 | 45 | 75.6% |
| 60–80 | 66 | 78.8% |
| 80–100 | 14 | 78.6% |

⚠️ The high bands are **n=45/66/14** — indicative, not established. The `<20` → `20-40` step
(52.3%) is the only part supported by a large sample, and it is flat.

**BULLISH — inverted and erratic:**

| Band | n | Hit |
|---|---|---|
| <20 | 250 | 28.8% |
| 20–40 | 1,333 | 45.3% |
| 40–60 | 282 | 33.0% |
| 60–80 | 1,271 | 36.1% |
| 80–100 | 227 | 63.9% |
| ≥100 | 105 | 23.8% |

## Finding 3 — the bearish/bullish gap is LARGELY A SAMPLE ARTEFACT, not a scoring asymmetry

This is the most important correction in this file. Signed return (positive = the signal's own
direction was rewarded):

| Signal | 15m | 1h | 4h | 24h |
|---|---|---|---|---|
| **bearish** | +0.024% | +0.028% | +0.097% | **+0.05%** |
| **bullish** | **−0.158%** | **−0.100%** | **−0.195%** | **−0.14%** |

Rows labelled `bullish` sat in instruments that **fell ~0.14% over the 4-day window**, so long
signals were marked wrong by the market. That explains much of bullish 40.3% vs bearish 52.4%
**without** any scoring defect.

⚠️ But note: **bearish signed return is positive at EVERY horizon.** That is a consistent
edge, and it is the one genuinely encouraging number here.

## Finding 4 — per-symbol results CONTRADICT each other (the instability evidence)

| Symbol | bullish hit | bearish hit |
|---|---|---|
| XAUUSD | 24.5% | 68.3% |
| AUDUSD | 41.8% | 59.6% |
| GBPUSD | 37.0% | 57.3% |
| NZDUSD | 34.7% | 58.4% |
| **USDJPY** | **54.2%** | **42.5%** ← inverted |
| **VIX** | **68.5%** | **41.9%** ← inverted |

When adjacent, highly-correlated FX pairs disagree in direction, the measurement is capturing
**4 days of one market regime**, not a stable property of the system. `USDJPY` and `VIX`
inverting is what a noise-dominated sample looks like.

## What this does and does not establish

**Establishes (with confidence):**
- The outcome pipeline **works end-to-end** — 12,172 rows matured with prices resolved. This
  was itself in doubt (`#733` noted "40,120 rows, zero horizon prices").
- There **is** measurable directional content in bearish signals across all four horizons.
- The bullish sample is **directionally biased by the period**, so bullish underperformance is
  **not yet** evidence of a scoring bug.

**Does NOT establish:**
- ❌ That scoring is fine. 4 days cannot show that.
- ❌ That mixing directives fails. **That question is not answerable at 4 days.**
- ❌ That any specific directive is broken. `n` per directive inside a class is far too small.
- ❌ That the system is profitable — **zero of this is PnL.** It is hit rate on price
  direction, which ignores spread, slippage, position sizing, and stop placement. A 52% hit
  rate can lose money.

## The honest bottom line for the decision the owner is making

**At 4 days there is not enough data to conclude either "scoring is flawed" or "the approach
works". Pausing to accumulate data is therefore a well-founded decision, not a defeat** — the
sample is simply too short to overrule either hypothesis.

The **single highest-value thing to build before pausing** is a way for the app to answer this
question on demand with confidence intervals, so that in 2–4 weeks the owner gets a verdict
instead of a feeling. Everything else is secondary to that.

## Capability Map Entry

- **name:** Directive Outcome Measurement (score-vs-correctness)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** partial — pipeline works; measurement at 4 days is underpowered

## QA Test Entry

- **area:** Scoring
- **name:** Directive outcome loop matures predictions with resolved prices
- **procedure:** `SELECT COUNT(*) FROM directiveoutcome WHERE outcomeComputedAt IS NOT NULL AND directionCorrect IS NOT NULL` after 24h of running.
- **expected:** Non-zero, and increasing daily. ⚠️ Known-good value 2026-09-12: **12,172 matured, 10,920 resolved.**

## Architecture Framework Entry

- **section:** data
- **summary:** Directive outcome learning loop is LIVE and maturing (12,172 rows, 10,920 with
  resolved direction, 4 horizon prices populated). Measured 2026-09-12: bearish signals show
  positive signed return at every horizon (+0.024% to +0.097%) while bullish rows are −0.10% to
  −0.20%, i.e. the sample period was falling — so the 52.4% vs 40.3% class gap is largely a
  regime artefact, NOT proven scoring asymmetry. Only **18 symbols / 18 directives / 4 days**,
  and `USDJPY`+`VIX` invert the class ordering, so the sample is noise-dominated.
  Files: `outcome-tracker.service.ts`, `directive-impact.service.ts`.
