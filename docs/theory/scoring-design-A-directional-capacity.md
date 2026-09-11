# Design A — Directional Capacity

> **The current design.** This document is its first complete written statement.
> The design is *mostly* sound; §A.5 documents a defect that is currently live.
>
> **Read `README.md` first** for the six questions and the comparison table.

---

## A.1 The model in one sentence

A reading is a fraction: **the directional magnitude a protocol earned**, divided
by **the directional capacity the protocol was configured with**.

## A.2 What a directive score is (Q1)

A directive returns a magnitude in $[0, \text{maxScore}]$. `maxScore` is declared
by the directive class and is the directive's **weight** — it is not a percentage.
A directive declaring `maxScore: 140` asserts it is worth 1.4× one declaring
`maxScore: 100`.

```
directive output = ( score ∈ [0, maxScore], signalClass, unmeasured?: true )
```

**Never** clamp to 100. The weight system is the entire point of declaring a
`maxScore` above 100 (ADR-010).

## A.3 What `signalClass` means (Q2)

Direction is carried **separately from magnitude**, in
`signalClass ∈ {bullish, bearish, neutral}`.

This separation is deliberate and it is the design's central good idea: a
directive measuring "the market moved 35 units" and a directive judging "the
market is moving up" are different assertions, and collapsing them into one
signed number loses the distinction between *magnitude* and *direction*.

### Is `neutral` a measurement or an absence?

**Unresolved in the code, and this is the defect.** Two readings are compatible
with what is implemented:

| Reading | Implication |
|---|---|
| **Neutral is an absence** | The directive found nothing directional → contributes nothing anywhere |
| **Neutral is a measurement** | The directive found real movement, judged non-directional → it is evidence, and discarding it loses information |

Measured reality (24h, 2026-09-11): neutral readings average **35.0** —
substantial, not zero. So **neutral is a measurement**, and the code treats it as
an absence in the numerator while treating it as a full-weight member in the
denominator. See §A.5.

## A.4 The maths (Q3, Q4)

Given a protocol with groups $G$, entries $d$ with `maxScore` $m_d$ and score
$s_d$, direction mode $M$, and risk multiplier $r$:

**Numerator — directional magnitude earned:**

$$
\text{earned} = \sum_{d \,\in\, \text{eligible}(M)} s_d \cdot \mathbb{1}[\,c_d \in \{\text{bullish},\text{bearish}\}\,]
$$

**Denominator — configured capacity (stable, ADR-011):**

$$
\text{configuredSignalMax} = \sum_{g \in G,\; \neg\,\text{riskGate}(g)} \;\; \sum_{d \in g} m_d
$$

**Composite and percentage:**

$$
\text{composite} = \text{earned} \cdot r
\qquad
\text{pct} = \frac{\text{composite}}{\text{configuredSignalMax}}
$$

**Why the denominator is config-derived and not observed** (ADR-011): an observed
denominator shrinks when a directive reads neutral, so a **quieter tick inflates
the percentage**, and the same reading scores differently between ticks. #758.

**Direction eligibility** (ADR-012) comes from `directionMode` in config, not from
the tick — so the denominator is fixed for the tick and identical across symbols.

## A.5 ⚠️ The live defect — asymmetric capacity

Put the two sums side by side and the asymmetry is visible by inspection:

| | condition applied |
|---|---|
| Numerator | $c_d \in \{\text{bullish}, \text{bearish}\}$ — **two of three classes** |
| Denominator | no class condition — **every** non-gate directive |

A directive that **can never emit direction** therefore adds its full `maxScore`
to the denominator while being *structurally incapable* of adding anything to the
numerator. It can only dilute. It cannot help.

### The measurement

24h across all active protocols:

| class | instances | avg score | total magnitude |
|---|---|---|---|
| **neutral** | **17,420** | **35.0** | **610,517** |
| bullish | 3,402 | 49.5 | 168,278 |
| bearish | 2,915 | 18.4 | 53,686 |

**78.6% of measured magnitude is neutral.**

Proof by decomposition — one real BUY reading:

```
rawComposite = 140 = 80 (rsi-oversold: bullish) + 60 (session-open-effect: bullish)
```

Everything else contributed **zero** to the numerator while occupying the
denominator with full weight:

| directive | score | maxScore |
|---|---|---|
| `speed-momentum` | **1.0** | 120 |
| `support-resistance-levels` | **11.0** | 95 |
| `volume-confirmation` | **16.0** | 100 |
| `bollinger-band-squeeze` | 31.0 | 90 (neutral) |
| `volatility-tools` | 37.0 | 90 (neutral) |

### Directives that have NEVER emitted a bullish reading

| directive | utilisation | bullish rate |
|---|---|---|
| `bollinger-band-squeeze` | 63.4% | **0.0%** |
| `gold-session-profile` | 50.0% | **0.0%** |
| `spy-qqq-relative-strength` | 46.7% | **0.0%** |
| `volatility-tools` | 37.9% | **0.0%** |
| `volume-confirmation` | 24.4% | **0.0%** |
| `support-resistance-levels` | 4.9% | **0.0%** |
| `speed-momentum` | 10.6% | 4.5% |
| `session-open-effect` | 0.9% | 0.3% |

`bollinger-band-squeeze` **performs 63% of its work** and has never been able to
contribute a single point to a reading.

### The three classes of directive output

The design has **two** slots — directional and risk gate — but there are **three**
kinds of output:

| # | class | belongs in denominator? |
|---|---|---|
| 1 | **Directional** — can be bullish or bearish | **yes** |
| 2 | **Non-directional evidence** — measures something real, never directional | **no** ← the defect |
| 3 | **Risk gate** — modulates confidence | no (correctly excluded via `isRiskGate`) |

Class 2 is the defect. It is exempt from the gate cascade, so `isGateGroup` is
false, and it is then counted as directional capacity.

## A.6 The fix — symmetric exclusion

$$
\text{configuredSignalMax} = \sum_{d \,:\, \text{canBeDirectional}(d)} m_d
$$

A directive that cannot be directional is excluded from capacity, symmetrically
with its exclusion from the numerator.

**`canBeDirectional` must be declared on the directive class, not measured.**

| Approach | Verdict |
|---|---|
| **Declared** — a property on the class | ✅ correct. A directive's *capability* is a property of its implementation. Stable denominator, ADR-011 preserved. A directive that lies is a one-file bug. |
| **Measured** — infer from history | ❌ rejected. Makes the denominator adapt, re-opening #758. |

### What this changes, worked

A protocol with `bollinger-band-squeeze` (90) + `volume-confirmation` (100) +
`volatility-tools` (90) currently carries 280 of capacity that can never be earned.
A protocol whose directional capacity is 500 would move from:

$$
\text{pct} = \frac{140}{780} = 17.9\% \qquad\longrightarrow\qquad \text{pct} = \frac{140}{500} = 28.0\%
$$

Same reading, same earned magnitude — the denominator now means what it claims to.

> ⚠️ **Do NOT instead lower the gate threshold.** That was the alternative
> proposal on #761. It changes the number without changing what produced it, and
> it would let genuinely weak readings through. The measurement says the *number*
> is wrong, not the *threshold*.

## A.7 What makes a reading eligible to trade (Q5)

1. `pct ≥ session.minComposite` for the participating bot
2. `directionMode` permits the direction
3. No risk gate has tripped
4. Market status is **not** closed/stale — `computeMarketStatus()` returns closed
   when freshness cannot be verified (fail-closed, `INV-GATE-FAILS-CLOSED`)
5. The reconciled gate applies — `reconcileGateWithBots()` may **lower** to the
   lowest participating bot's `minComposite`, never raise (`INV-GATE-RECONCILED`)

## A.8 Failure mode (Q6)

**Idle capacity looks like a low score, silently.**

A protocol carrying class-2 directives prints a small, stable, plausible
percentage that never crosses the gate. Nothing errors. The symptom is a bot
that is "actively scoring" and never trades — which is indistinguishable from
"no opportunity exists", and that is exactly why this survived for weeks.

**Diagnostic tell (currently live):** compare `earned` against `observedMax` on
the same reading. Measured at **53.9% on BUY readings** — i.e. ~46% of live
directional evidence is not claimed. On a healthy design this ratio should be
close to 1 when direction is present.

**Second diagnostic:** the risk multiplier is **0.796 on BUY** versus 0.933 on
HOLD. That is a *second, independent* suppressor and it compounds. Even with
§A.6 fixed, `earned × 0.796` will show below the raw ratio.

## A.9 Trade-offs accepted by this design

| Accepted | Rationale |
|---|---|
| Idle capacity from a *directional* directive still counts | It represents room that existed and was not taken. That is intended, not a bug. |
| A percentage does not say whether the market was quiet | It says whether direction was taken. Quietness is a separate question, answered by evidence sums and the market-status gate. |
| `neutral` from a *directional-capable* directive still counts as unused capacity | It could have contributed and didn't. Whether it *should* count as ambiguity is Design C's question. |

## A.10 Implementation checklist for §A.6

- [ ] Add `canBeDirectional` (or equivalent) to the directive base class, defaulting `true`
- [ ] Set `false` on the class-2 directives measured in §A.5
- [ ] Exclude them in `protocol-gating.service.ts` capacity accumulation — the
      guard currently reads `if (!isGateGroup)` and must also test capability
- [ ] **Do not** add `directionBias` to that guard — attempt reverted, see below
- [ ] Add an `INV-*` row + build guard + QA entry
      (`meta-stack-contracts.instructions.md` requires all three)
- [ ] Write a handoff

> ⚠️ **A reverted attempt, recorded so nobody retries it.** Gating capacity on
> `directionBias` was implemented and reverted (2026-09-10). It excluded
> `macd-crossover`, which declares `neutral` yet emitted a direction **5,252
> times**. `directionBias` describes the directive's *typical* polarity;
> `canBeDirectional` must describe its *capability*. They are not the same
> property and conflating them removed the hardest-working directives.

## Related

- `README.md` — the six questions, the three-design comparison
- Design B (`scoring-design-B-observed-evidence.md`), Design C (`scoring-design-C-confidence-weighted.md`)
- ADR-010 (magnitudes), ADR-011 (stable denominator), ADR-012 (config eligibility), ADR-014 (one implementation)
- Issue #761, #758; protocol `hourly-3dir-v1`
