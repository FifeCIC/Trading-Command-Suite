# Design B — Observed Evidence

> **Groundwork, not implemented.** This design answers the same six problems as
> Design A with a different denominator. It resolves A's defect *and* re-opens
> #758 deliberately.
>
> **Read `README.md` first** for the six questions and the comparison table.

---

## B.1 The model in one sentence

A reading is the share of **everything the protocol measured this tick** that
agreed on a direction.

## B.2 Why this design exists

Design A asks: *"of the directional room available, how much was taken?"*

Design B asks a different and arguably more human question: *"of what we actually
measured right now, how much agrees?"*

The difference matters most in exactly the case that broke A. When a protocol
carries directives that are currently silent, A's denominator keeps counting them
and the percentage falls — not because the market is unfavourable, but because the
*denominator* remembers a capability the *market* is not exercising. B has no such
memory: silent directives contribute ~0 to both sums, so they simply stop
appearing in the ratio.

## B.3 What a `neutral` reading means (Q2)

**Neutral is a measurement, and it actively dilutes.**

If three directives fire — two strongly bullish, one neutral at a substantial
magnitude — the neutral one is telling you the market moved *without direction*.
B treats that as **genuine ambiguity**, and ambiguity should lower the score.
Discarding it (as A does) throws away the information that the move was
incoherent.

This is the design that most directly honours the intuition:

> *"isn't movement one way or another an indication of not being the opposite
> way... I just wonder if neutral needs to be framed/treated differently"*

B's answer is that neutral is neither discarded nor promoted — it is **counted,
and it counts against confidence in direction**.

## B.4 The maths

$$
\text{pct}_B = \frac{\displaystyle\sum_{d} s_d \cdot \mathbb{1}[\,c_d \in \{\text{bullish},\text{bearish}\}\,]}
{\displaystyle\sum_{d} s_d}
$$

Both sums are **observed magnitudes from this tick only**. No configuration
appears in the denominator.

### Worked examples

**Coherent tick** — three directives fire:

| directive | score | class |
|---|---|---|
| `ema-structure` | 80 | bullish |
| `macd-crossover` | 60 | bullish |
| `rsi-oversold` | 40 | neutral |

$$
\text{pct}_B = \frac{80 + 60}{80 + 60 + 40} = \frac{140}{180} = 77.8\%
$$

**Incoherent tick** — ten fire, two directional:

$$
\text{pct}_B = \frac{140}{400} = 35.0\%
$$

**Quiet tick** — two fire, both bullish:

$$
\text{pct}_B = \frac{140}{140} = 100\%
$$

That last case is B's central hazard — see §B.7.

## B.5 The trade-offs — stated honestly

### For

- **The defect in A dissolves.** No configured denominator means no idle-capacity
  inflation. A directive that cannot be directional contributes 0 to both sums
  and is simply absent from the ratio.
- **The percentage answers an actionable question.** "Of what we measured, how
  much agreed?" is a question a trader can reason about directly.
- **Incoherent markets are naturally penalised**, which is arguably correct
  behaviour and is something A cannot express at all.

### Against — and one of these is disqualifying as written

**1. The denominator moves between ticks. This is #758.**

The denominator depends on which directives happened to produce a reading. So:

- The same market can score differently on consecutive ticks with no change in
  price — because a different set of directives fired.
- A "quieter" tick can *inflate* the percentage: fewer directives firing makes
  the ratio easier to max out (see the 100% case above).

#758 rejected an observed denominator for exactly this reason, with hard evidence:

> *"an observed denominator made the same reading score differently between ticks
> (it shrinks when a directive reads neutral, so a quieter tick inflates the
> percentage), and gave one protocol two different maxima for two symbols in the
> same tick."*

**B re-introduces that deliberately.** It is only defensible if the movement is
reframed as a *feature* — the ratio is a property of the tick's coherence, not of
the protocol's configured potential — and then the **gate must be re-specified**,
because a fixed threshold on a moving denominator means different things on
different ticks.

**2. Not comparable across symbols (P4).**

Two symbols in the same tick can have different evidence sums, so the same
percentage means different things. This is #758's second half. Design A is
immune because capacity is per-protocol config.

**3. The diagnostic tell disappears (P5).**

A's live tell is the ratio `earned / observedMax` sitting at **53.9%** instead of
near 1. Under B the denominator *is* the observed sum, so a low percentage is
**expected** and the tell is gone. A design that cannot distinguish a wrong number
from a right one is much harder to debug — and every incident in this codebase's
history presented as *plausible numbers with no error*.

## B.6 What makes a reading eligible to trade (Q5)

Everything from A, **plus a new mandatory condition**:

6. **A minimum evidence requirement** — a floor on $\sum_d s_d$ (or on the count
   of firing directives), without which a two-directive tick can read 100%.

B **must** define this explicitly. Without it, §B.7 is not a risk, it is the
normal behaviour.

7. The gate threshold is meaningless as a fixed constant on a moving denominator
   and must be expressed as either a **percentile of recent readings** or a
   **coherence measure** rather than an absolute percentage.

## B.7 Failure mode (Q6)

**A quiet tick reads as a strong signal.**

Two directives fire, both bullish, percentage is 100% — on almost no evidence.
Nothing errors, and the number is *plausible* (it is 100% of a real, correctly
computed ratio). This is the same class of failure as every other incident in this
codebase: a correct-looking number produced by a design that never stated the
condition under which it is wrong.

**Secondary failure mode:** the gate drifts silently. A threshold of 65 means "65%
of what fired this tick" — and if the composition of firing directives changes
over the day (session directives firing in the morning, momentum directives all
day), the *same* threshold admits different qualities of signal at different
hours. Nothing in the score records which case it was.

## B.8 What B would need before implementation

| Requirement | Why |
|---|---|
| A stated minimum-evidence rule | otherwise quiet ticks read 100% |
| A gate expressed relative to recent readings, not an absolute % | a fixed threshold on a moving denominator is not a fixed standard |
| Persistence of the evidence sum on every row | without it, no reading is interpretable after the fact |
| An acceptance that symbol-to-symbol comparison is void | or a normalisation, which reintroduces a denominator |
| A replacement diagnostic for P5 | A's tell is gone |

## B.9 When B is the better design

If the goal is to **avoid trading incoherent markets** and the gate is redesigned
around coherence rather than a fixed score, B is better than A — it expresses
something A cannot express at all. A answers *"did this opportunity meet the bar
we configured?"*; B answers *"is the market being coherent right now?"* Those are
different questions, and for an intraday strategy B's question may be the more
useful one.

That is a genuine strategic decision, which is why this document exists rather
than a patch.

## Related

- `README.md` — the six questions, the three-design comparison
- Design A (`scoring-design-A-directional-capacity.md`) — the current design and its defect
- Design C (`scoring-design-C-confidence-weighted.md`) — keeps A's denominator, promotes neutral to confidence
- ADR-011 (why an observed denominator was rejected), ADR-014 (one implementation per concept)
- Issue #758 (the observed-denominator evidence)
