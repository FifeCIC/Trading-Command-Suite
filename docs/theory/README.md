# Scoring System Design — Three Approaches

> **Status:** groundwork. Design A is the current design. Designs B and C are
> alternatives. Nothing here is implemented except A, and A is not correct as
> written — see §A.4.
>
> **Read this when:** you are about to change a denominator, a directive's
> `signalClass`, a gate threshold, or add a directive to a protocol. The whole
> point of this folder is that those four changes look local and are not.

---

## Why this folder exists

Between July and September 2026 the same conversation happened repeatedly, and
each round produced a different diagnosis of the same symptom:

| Issue | Diagnosis | Was it real? |
|---|---|---|
| #750 | timestamps were broker-local, ~3h in the future | yes |
| #751 | bar arrays reached directives newest-first | yes |
| #758 | the denominator was observed, so it moved between ticks | yes |
| #761 | directional capacity was included that could never be directional | yes, and still open |
| #780 | daily bars were stored 30 min off their cadence boundary | yes |
| #783 | the same as #780, for import | yes |

All six were real, all six were load-bearing, and all six produced **plausible
numbers with no error**. That is the signature of a system whose design was never
written down: each agent re-derived the intent from the code, and the code cannot
distinguish *"this is the design"* from *"this is a bug someone left"*.

The loop is not the agent being indecisive. It is the absence of a document that
says which decisions are settled. ADR-010 … ADR-014 fixed this for scoring
specifically and the churn stopped on those points. This folder extends the same
treatment to the **whole scoring design**, by putting three coherent alternatives
side by side so that a change can be judged against a stated approach rather than
against the current state of the code.

---

## The six questions every design must answer

Answer these for any design before implementing it. A design that cannot answer
question 6 cannot be debugged, and every incident in the table above was found by
someone asking it by accident.

| # | Question |
|---|---|
| 1 | What **is** a directive `score`? Units, bounds, meaning. |
| 2 | What does `signalClass` mean — and is `neutral` a **measurement** or an **absence**? |
| 3 | What exactly is the **denominator**, and is it stable within a tick? |
| 4 | How does a **non-directional** reading affect the result? |
| 5 | What makes a reading **eligible to trade**? |
| 6 | **What is the failure mode** — what does a *wrong* number look like? |

Question 2 is the one that has never had a written answer, and it is the root of
the currently-open #761.

---

## The three designs at a glance

| | **A — Directional Capacity** | **B — Observed Evidence** | **C — Confidence Weighted** |
|---|---|---|---|
| Denominator | configured directional capacity | all observed magnitude | configured capacity |
| Neutral's effect | **indeterminate** (see A.4) | dilutes the percentage | contributes as confidence |
| Stable within a tick | yes (ADR-011) | **no** — it moves | yes |
| Percentage means | "how much of the available directional room was taken" | "how much of what we measured was directional" | "how much directional room was taken, weighted by agreement" |
| Comparable across symbols | yes | **no** | yes |
| New machinery needed | none | none | a belief model |
| Trading-ready today | **yes, once A.4 is fixed** | no — needs a re-think of the gate | no |
| Risk | idle capacity inflates the scale | a quiet tick inflates the score | unvalidated model |

**Recommendation:** implement **A with A.4 fixed**, today. Capture B and C as
groundwork for a second version. This is the fastest route to trading *and* the
only one whose maths is currently defensible.

---

# Design A — Directional Capacity

The design the app uses now, written down properly for the first time.

## A.1 What a directive score is

A directive returns a **magnitude** in `[0, maxScore]`, where `maxScore` is
declared by the directive class. Magnitude is **not** a percentage and must never
be clamped to 100 — a directive with `maxScore: 140` is asserting it is worth
1.4× a `maxScore: 100` directive, and that weighting is the whole point
(ADR-010). Direction is carried **separately** in `signalClass ∈ {bullish,
bearish, neutral}`.

```
directive output = ( score ∈ [0, maxScore], signalClass, unmeasured?: true )
```

## A.2 What `neutral` means (the unresolved question)

Not settled. Two readings are compatible with the current code and they imply
different fixes:

- **Reading 1 — neutral is an absence.** The directive looked and found nothing
  directional. Then it should contribute 0 to the numerator *and* 0 to the
  denominator.
- **Reading 2 — neutral is a measurement.** The directive found real movement and
  judged it non-directional. Then it is **evidence for the status quo**, and
  discarding it throws away information (this is the user's argument, and the
  measurement in A.4 supports it).

The code currently does neither: neutral contributes **0 to the numerator** but
its **full `maxScore` to the denominator**. That is not a design, it is an
inconsistency, and it is the mechanism behind #761.

## A.3 The maths, as specified

For a protocol with directive groups $G$, directive entries $d$, a direction mode
$M$, and a risk multiplier $r$:

$$
\text{earned} = \sum_{d \,\in\, \text{eligible}(M)} s_d \cdot [\,c_d \in \{\text{bullish},\text{bearish}\}\,]
$$

$$
\text{capacity} = \sum_{g \,\in\, G,\; g \notin \text{riskGate}} \;\sum_{d \,\in\, g} \text{maxScore}_d
$$

$$
\text{configuredSignalMax} = \text{capacity} \qquad \text{(stable — ADR-011)}
$$

$$
\text{composite} = \text{earned} \cdot r
$$

$$
\text{pct} = \frac{\text{composite}}{\text{configuredSignalMax}}
$$

Two asymmetries are visible by inspection:

1. **The indicator is not symmetric.** `[c_d ∈ {bullish, bearish}]` admits only
   two of three classes' magnitudes. So $\text{earned}$ has a ceiling well below
   $\text{capacity}$.
2. **The denominator has no such indicator.** Every non-gate directive's
   `maxScore` is counted, regardless of whether it can ever be directional.

## A.4 The measured defect — this is a bug, not a theory question

Measured over 24h across all active protocols (2026-09-11):

| class | instances | avg score | total magnitude |
|---|---|---|---|
| **neutral** | **17,420** | **35.0** | **610,517** |
| bullish | 3,402 | 49.5 | 168,278 |
| bearish | 2,915 | 18.4 | 53,686 |

**78.6% of all measured magnitude is neutral**, at an average of 35.0 — not
near-zero. Neutral readings are substantial measurements being discarded from the
numerator while still occupying the denominator.

The proof is a single real BUY reading, where the composite decomposes exactly:

```
rawComposite = 140  =  80 (rsi-oversold, bullish)  +  60 (session-open-effect, bullish)

meanwhile in the denominator:
  speed-momentum              1.0 of 120
  support-resistance-levels  11.0 of  95
  volume-confirmation        16.0 of 100
```

Those three contributed **zero** to the numerator. Nine directives that have
**never once emitted a bullish reading** in 24h still occupy the denominator with
full `maxScore`:

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

**Conclusion.** There are **three** kinds of directive output and the design has
two slots:

1. **Directional** — can be bullish or bearish
2. **Non-directional evidence** — measures something real, can *never* be
   directional
3. **Risk gate** — modulates confidence, correctly excluded via `isRiskGate`

**Class 2 is the defect.** It is exempt from the gate cascade (so `isGateGroup` is
false) but *included* in directional capacity — so it cannot help and can only
dilute. `bollinger-band-squeeze` does 63% of its work and has never been able to
contribute a point to a reading.

## A.5 The fix within Design A

Make the indicator symmetric. A directive whose `signalClass` cannot be
directional must not occupy directional capacity:

$$
\text{capacity}' = \sum_{d \,:\, \text{canBeDirectional}(d)} \text{maxScore}_d
$$

Two ways to know `canBeDirectional`:

- **Declared** — a property on the directive class. Cheap, explicit, and a
  directive that lies is a single-file bug.
- **Measured** — a directive that has never emitted direction over N readings is
  excluded. Adaptive, but it makes the denominator move, which re-opens #758.

**Declared is correct.** A directive's *capability* is a property of its
implementation; its *current reading* is not. Declaring it keeps
`configuredSignalMax` stable, which is ADR-011.

> ⚠️ **Do not** simply lower the gate threshold to make percentages look better.
> That was the alternative proposal on #761 and it is wrong: it changes the
> number without changing what produced it.

## A.6 Failure mode of Design A

**Idle capacity looks like a low score.** A protocol carrying directives that
cannot fire in the current regime prints a *small, plausible, stable* percentage
that never crosses the gate — and nothing errors. Symptom: a bot that is
"actively scoring" and never trades.

**Second failure mode:** a percentage that appears comparable across protocols but
is not, because each protocol carries a different proportion of class-2 capacity.
Comparing a protocol with two such directives against one with six is comparing
two different scales.

---

# Design B — Observed Evidence

## B.1 What a directive score is

Same as A: magnitude in `[0, maxScore]`, direction in `signalClass`.

## B.2 What `neutral` means

**Neutral is a measurement, and it actively dilutes.** If a directive measures 35
units of non-directional movement, that is *ambiguity*, and ambiguity should lower
confidence in a directional read rather than being discarded.

This is the design that most directly honours the user's argument: *"isn't
movement one way or another an indication of not being the opposite way"* — B
turns that intuition into a term.

## B.3 The maths

$$
\text{pct}_B = \frac{\displaystyle\sum_{d} s_d \cdot [\,c_d \in \{\text{bullish},\text{bearish}\}\,]}
{\displaystyle\sum_{d} s_d}
$$

The denominator is **observed evidence**, so:

- A tick where three directives fire and two are strongly directional scores
  **high** (e.g. $80/120 = 67\%$).
- A tick where ten fire and two are directional scores **low** (e.g. $80/400 =
  20\%$).

## B.4 The trade-off

**For:** the percentage answers a question a human can act on — *"of everything we
measured, how much agreed on a direction?"* It is naturally penalised by
incoherent markets, which is arguably exactly what a trader wants.

**Against, and it is disqualifying as written:** the denominator **moves between
ticks for reasons unrelated to the score**, because it depends on which directives
happened to produce a reading. That is precisely the #758 defect — *"an observed
denominator made the same reading score differently between ticks, and gave one
protocol two different maxima for two symbols in the same tick."*

**B is only viable if that is accepted as a feature rather than a bug**, and the
gate is re-specified in terms of evidence coherence rather than a fixed
percentage. That is a substantial change and it is why B is groundwork, not
today's work.

## B.5 Failure mode of Design B

**A quiet tick reads as a strong signal.** If only two directives fire and both
are bullish, the percentage is $100\%$ on almost no evidence. Some minimum
evidence requirement is mandatory, and B must define it explicitly or it will
produce confident signals from noise.

---

# Design C — Confidence Weighted

## C.1 What a directive score is

Same: magnitude in `[0, maxScore]`, direction in `signalClass`. But `neutral` is
promoted to a **first-class confidence input**.

## C.2 What `neutral` means

Neutral is **information about ambiguity**, and it sits between "supports" and
"contradicts". A protocol read consists of:

- **Direction** — from the directional magnitudes
- **Confidence** — from agreement among all directives, including neutral ones

This is the only design in which the user's intuition is *fully* expressed:
neutral is neither discarded (A) nor merely diluting (B) — it is a weak
indication that is *counted, weighted, and bounded*.

## C.3 The maths

Let $D$ be the directional set, $N$ the neutral set, and $\bar{n}$ the mean
neutral magnitude relative to its own capacity:

$$
\text{direction} = \sum_{d \in D} s_d \cdot \text{sign}(c_d)
\qquad
\text{agreement} = \frac{\sum_{d \in D} s_d}{\sum_{d \in D} \text{maxScore}_d}
$$

$$
\text{ambiguity} = \frac{\sum_{n \in N} s_n}{\sum_{n \in N} \text{maxScore}_n}
\qquad
\text{confidence} = \text{clamp}\big(\text{agreement} - \alpha \cdot \text{ambiguity},\; 0,\; 1\big)
$$

$$
\text{composite} = \text{direction} \cdot \text{confidence} \cdot r
\qquad
\text{pct} = \frac{|\text{composite}|}{\text{configuredSignalMax}}
$$

$\alpha$ is the **ambiguity penalty** and it is the single most important
tunable in this design. $\alpha = 0$ collapses C into A. $\alpha \to 1$ makes any
non-directional activity disqualifying.

## C.4 The trade-off

**For:** it is the only design that can express *"a directional read amid strong
non-directional activity is less trustworthy"*. It keeps A's stable denominator,
so ADR-011 is preserved. It also gives `neutral` a job, which resolves the
"neutral is presence, not absence" complaint properly.

**Against:** $\alpha$ is unvalidated and will need calibration against real
outcomes. Introduces a **multiplicative** stage, and this codebase already has one
(the risk multiplier), which is measured at **0.796 on BUY readings** — a second
suppressor that compounds with whatever C adds. Two multiplicative stages on one
composite is a design smell worth naming now.

## C.5 Failure mode of Design C

**Silent over-suppression.** If $\alpha$ is too high then confident directional
reads get damped below the gate and nothing fires — presenting identically to
Design A's defect but with an extra number to check. And because confidence is
multiplied, a bug in either factor looks like a *plausible* score rather than a
broken one.

---

# Cross-cutting problems and how each design answers

## P1 — Neutral magnitude is discarded from the numerator but kept in the denominator

| | Answer |
|---|---|
| **A** | Fix by symmetric exclusion: a directive that *cannot* be directional leaves capacity too (§A.5). Neutral from a directive that *can* be directional stays in capacity, on the grounds that it could have contributed and didn't. |
| **B** | Dissolves the problem — there is no configured denominator. Neutral simply dilutes, which is B's intended behaviour. |
| **C** | Neutral is counted as ambiguity, so it neither disappears nor merely dilutes. |

## P2 — The denominator moved between ticks (#758)

| | Answer |
|---|---|
| **A** | Fixed by ADR-011: `configuredSignalMax` is config-derived and stable. |
| **B** | **Re-introduced deliberately.** Must be paired with an evidence-coherence gate. |
| **C** | Preserved from A. |

## P3 — Idle directives accumulate capacity

| | Answer |
|---|---|
| **A** | Fixed by §A.5 — class-2 directives leave the denominator. Remaining idle capacity (a directional directive that found nothing) is *intended*: it represents room that existed and was not taken. |
| **B** | Self-solving: an idle directive contributes ~0 to a sum of observed magnitudes. |
| **C** | Revealed, not hidden: persistent idle capacity lowers `agreement`, so the confidence term exposes it. |

## P4 — The percentage must be comparable across symbols in the same tick

| | Answer |
|---|---|
| **A** | Yes — capacity is per-protocol config, so it does not vary by symbol. |
| **B** | **No.** Two symbols can have different evidence sums. This is #758's second half. |
| **C** | Yes, if `maxScore` is per-protocol rather than per-symbol. Note the existing `SymbolCalibration` weight-multiplier table is a **third** factor that silently affects this and is worth auditing separately. |

## P5 — A wrong number must be distinguishable from a right one

| | Answer |
|---|---|
| **A** | Only via the ratio `earned / observedMax`. Measured at **53.9% on BUY** readings, which is the current live tell that evidence is being lost. |
| **B** | Harder — with a moving denominator, a low percentage is *expected*, so the tell disappears. |
| **C** | Two failure surfaces (direction, confidence) both of which produce plausible numbers. Requires `confidence` to be **persisted and displayed**, or it is undebuggable. |

---

# What to do next

1. **Implement A.5** — declare `canBeDirectional` on directive classes; a
   directive that cannot be directional leaves `configuredSignalMax`. This is the
   correct fix for #761, and it is *not* a threshold change.
2. **Run the control protocol** — `hourly-3dir-v1` (three directional-only
   directives, no session directive, no risk gate, EURUSD 1h). Its prediction is
   falsifiable: if the ceiling is a denominator artefact it should print
   materially above ~23%; if it still prints ~25% the loss is inside composite
   assembly — the risk multiplier at 0.796, or `selectDirectionalEvidence`
   selecting the minority side — and #761 was treating a symptom.
3. **Leave B and C as groundwork.** Do not implement them as competing paths in
   one app: two scoring designs running simultaneously is the most expensive kind
   of debt, and ADR-014 already forbids a second implementation of a settled
   concept.
4. **Do not lower the gate threshold to improve the number.** The measurement in
   §A.4 says the number is wrong, not the threshold.

---

## Change protocol for this folder

These documents are **settled designs, not frozen decisions**. Re-opening is
allowed and productive. What is not allowed is re-deciding by accident.

Before changing anything covered here, answer in the issue:

> **Which design does this touch — and am I fixing a bug in it, or re-deciding
> the approach?**

A **bug fix** implements a stated design correctly. A **re-decision** changes the
design, and must update the matching design document in the same change so the
next agent reads the intent rather than reverse-engineering it.

| Document | Design |
|---|---|
| `docs/theory/scoring-design-A-directional-capacity.md` | A — directional capacity |
| `docs/theory/scoring-design-B-observed-evidence.md` | B — observed evidence |
| `docs/theory/scoring-design-C-confidence-weighted.md` | C — confidence weighted |

## Related

- `ADR-010` … `ADR-014` in `DECISIONS.md` — the settled scoring decisions
- `.github/instructions/meta-stack-contracts.instructions.md` — the enforced invariants
- Issue **#761** — the directional-capacity defect measured in §A.4
- Issue **#758** — why an observed denominator was rejected
- Protocol **`hourly-3dir-v1`** — the control experiment
