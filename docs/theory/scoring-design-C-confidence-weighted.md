# Design C — Confidence Weighted

> **Groundwork, not implemented.** This design keeps Design A's stable
> denominator and promotes `neutral` from a discarded value to a first-class
> confidence input.
>
> **Read `README.md` first** for the six questions and the comparison table.

---

## C.1 The model in one sentence

A reading is **a direction, a magnitude, and a confidence** — and A's mistake was
having only the first two.

## C.2 Why this design exists

Design A discards neutral magnitude from the numerator but keeps its capacity in
the denominator, so neutral can only hurt. Design B lets neutral dilute the score.

Neither treats neutral as what the measurement says it is: **information about how
ambiguous the market is.**

Design C is the only one of the three in which the following sentence is fully
expressible:

> *"A strongly directional read made amid heavy non-directional activity is less
> trustworthy than the same directional read made amid silence."*

A cannot say this (it ignores neutral entirely). B says something adjacent but
different — it says the directional share is smaller, which is a statement about
proportion, not about trust. C says it directly, by letting ambiguity **modulate**
the directional read.

## C.3 What a `neutral` reading means (Q2)

**Neutral is information about ambiguity, and it sits between "supports" and
"contradicts".**

The key distinction from both other designs:

| Design | What neutral does |
|---|---|
| **A** | Nothing in the numerator; full weight in the denominator. Net effect: **harmful, silently** |
| **B** | Dilutes the share. Net effect: **a tax on the score** |
| **C** | Reduces *confidence*, leaving direction intact. Net effect: **a discount on trust** |

C is the design where the user's framing — *"neutral becomes weak because it's
neutral... isn't movement one way or another an indication of not being the
opposite way"* — is **exactly** the implemented behaviour. Neutral is not zero and
not a veto; it is a **weak, bounded, counted** indication.

## C.4 The maths

A read decomposes into three terms.

### 1. Direction — signed, from the directional magnitudes

$$
\text{direction} = \sum_{d \in D} s_d \cdot \text{sign}(c_d)
\qquad D = \{d : c_d \in \{\text{bullish}, \text{bearish}\}\}
$$

### 2. Agreement — how much of the directional capacity actually agreed

$$
\text{agreement} = \frac{\displaystyle\sum_{d \in D} s_d}{\displaystyle\sum_{d \in D} m_d}
\;\in\; [0, 1]
$$

### 3. Ambiguity — how much non-directional activity is present

$$
\text{ambiguity} = \frac{\displaystyle\sum_{n \in N} s_n}{\displaystyle\sum_{n \in N} m_n}
\;\in\; [0, 1]
\qquad N = \{n : c_n = \text{neutral}\}
$$

### Confidence, and the composite

$$
\text{confidence} = \text{clamp}\big(\text{agreement} - \alpha \cdot \text{ambiguity},\; 0,\; 1\big)
$$

$$
\text{composite} = \text{direction} \cdot \text{confidence} \cdot r
\qquad
\text{pct} = \frac{|\text{composite}|}{\text{configuredSignalMax}}
$$

### The two constants

| constant | meaning | range |
|---|---|---|
| $\alpha$ | **ambiguity penalty** — how much non-directional activity discounts a directional read | $[0, 1]$ |
| $r$ | the existing risk multiplier | existing |

$\alpha = 0$ collapses C into Design A — direction is trusted fully regardless of
ambiguity. $\alpha \to 1$ makes any substantial non-directional activity
disqualifying. **$\alpha$ is the single most important tunable in this design** and
it is unvalidated; it must be calibrated against real outcomes, not chosen by
taste.

### Worked example

Suppose a protocol has directional capacity 300 and neutral capacity 180, and a
tick reads:

| directive | score | class | capacity |
|---|---|---|---|
| `ema-structure` | 90 | bullish | 100 |
| `macd-crossover` | 45 | bullish | 90 |
| `rsi-oversold` | 30 | neutral | 140 |

$$
\text{agreement} = \frac{135}{190} = 0.711
\qquad
\text{ambiguity} = \frac{30}{140} = 0.214
$$

With $\alpha = 0.5$:

$$
\text{confidence} = 0.711 - (0.5)(0.214) = 0.604
$$

$$
\text{direction} = 135
\qquad
\text{composite} = 135 \times 0.604 = 81.5
\qquad
\text{pct} = \frac{81.5}{480} = 17.0\%
$$

Compare the same direction with **no** neutral activity:

$$
\text{confidence} = 0.711
\qquad
\text{composite} = 135 \times 0.711 = 96.0
\qquad
\text{pct} = 20.0\%
$$

Same direction, same capacity — the ambiguous tick is discounted **3 percentage
points**. That difference is precisely the information Design A currently throws
away.

## C.5 The trade-offs

### For

- **Neutral gets a job.** It is neither discarded (A) nor a blunt tax (B). This
  resolves the defect in A.5 *and* the "neutral is presence, not absence"
  complaint, in one mechanism.
- **ADR-011 is preserved.** The denominator is `configuredSignalMax`, config-derived
  and stable within a tick.
- **Cross-symbol comparability is preserved** (P4) — capacity is per-protocol.
- **The design can express regime.** Directional read + high ambiguity means
  "trending in a choppy tape". A cannot say this; B says it only as a smaller
  number.

### Against — stated plainly

**1. $\alpha$ is unvalidated, and it is load-bearing.**

A badly chosen $\alpha$ silently damps every signal. There is no way to know the
right value without calibrating against outcomes, which means either backtesting
or a period of watching. Until then $\alpha$ is a guess with a decimal point.

**2. A second multiplicative stage on one composite.**

This codebase already has one — the risk multiplier — and it is measured at
**0.796 on BUY readings** versus 0.933 on HOLD. That is a suppressor nobody
designed as one. Adding `confidence` as a *second* multiplier means:

- The two compound: `direction × confidence × r`
- A bug in either looks like a plausible score rather than a broken one
- Attributing a low percentage becomes harder, not easier

**Two multiplicative stages on one composite is a design smell and it should be
named before implementation, not discovered after.**

**3. Two failure surfaces instead of one.**

`direction` and `confidence` can each be wrong, and they can cancel — a too-high
direction and a too-low confidence produce a plausible mid-range number.

**4. `clamp(..., 0, 1)` hides the difference between "no agreement" and "high ambiguity".**

A confidence of exactly 0 could mean *"nothing agreed"* or *"agreement was fully
cancelled by ambiguity"*. Those are different states and the composite cannot
distinguish them. Confidence must be **persisted and displayed**, or C is
undebuggable.

## C.6 What makes a reading eligible to trade (Q5)

Everything from A, plus:

6. **`confidence` above a stated floor** — a directional read amid heavy ambiguity
   should not be tradeable even if `pct` crosses the gate
7. **`confidence` persisted on the Score row**, so a low composite can be
   attributed after the fact

## C.7 Failure mode (Q6)

**Silent over-suppression — indistinguishable from Design A's defect.**

If $\alpha$ is too high, confident directional reads are damped below the gate and
nothing fires. The presentation is *identical* to A's idle-capacity problem: a
score that is small, stable, plausible, and never crosses the threshold. The
difference is that C has an extra number to check — which only helps **if that
number is persisted and visible**.

**Second failure mode:** the two multiplier stages partially cancel, so neither a
too-high risk multiplier nor a too-low $\alpha$ is individually detectable from
the final percentage. This is the "plausible numbers with no error" class, and C
makes it *worse* than A unless observability is built in from the start.

## C.8 What C would need before implementation

| Requirement | Why |
|---|---|
| `confidence` persisted on every Score row | otherwise the extra failure surface is invisible |
| `confidence` displayed on the ladder/card | a user seeing 17% must be able to tell *why* |
| A calibration plan for $\alpha$ | it is load-bearing and currently arbitrary |
| A decision on whether $r$ and $\text{confidence}$ should be one stage or two | two multipliers compound and cancel |
| A stated resolution of `confidence == 0` | "no agreement" vs "cancelled by ambiguity" |
| An audit of `SymbolCalibration` weight multipliers | a **third** silent factor on the same composite — worth verifying against ADR-014 |

## C.9 When C is the better design

If the app is going to trade **through ambiguous regimes** rather than only
coherent ones, C is the right design — it is the only one that can express
*"directional, but how much do we trust it?"* as a quantity rather than as a
smaller percentage.

It is also the natural home for the neutral question, because it is the only
design where neutral is treated as **information** rather than as either an
absence or a tax.

It is however the most expensive of the three: two new mechanisms (a confidence
term and an ambiguity constant), a new failure surface, and a calibration debt.
That cost is why it is groundwork.

## Related

- `README.md` — the six questions, the three-design comparison
- Design A (`scoring-design-A-directional-capacity.md`) — the current design and its defect
- Design B (`scoring-design-B-observed-evidence.md`) — the observed-denominator alternative
- ADR-010 … ADR-014 in `DECISIONS.md`
- Issue #761 (the defect), #718 (group weights — not applied in assembly)
