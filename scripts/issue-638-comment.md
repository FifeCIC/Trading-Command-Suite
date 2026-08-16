## Resolution — Dual-Score Model (Opportunity vs Signal)

Issue #638 started as "separate gates from scores / fix the 42% BUY noise floor" and landed on a cleaner, industry-standard answer: **SEES now emits two scores instead of one muddled number.**

### The two scores

| Score | What it is | Denominator | Used for |
|-------|------------|-------------|----------|
| **Opportunity** | Additive "everything counts" — direction + conditions + forecasts + liquidity + analyst notes | Static (all directive weights, e.g. 945/1010) | Ranking / screening the universe — "find the golden needle in a haystack of silver needles" |
| **Signal** | Directional conviction only — which way, how strongly, *right now* (directives whose `signalClass` is bullish/bearish) | Dynamic (sum of directional weights that fired, e.g. 170) | Timing — drives BUY/HOLD/SELL and the automation loop |

### Why two scores instead of one

- **Screening ≠ timing.** A symbol can be a fantastic *opportunity* (lots of confluence, forecasts aligned, liquid, in a good session) while having **no tradeable directional signal yet** (e.g. momentum flat, S/R mid-range). Collapsing both into one number produced the "42% BUY noise floor" — neutral conditions were propping up directional conviction.
- **Gates belong on Signal, not Opportunity.** Liquidity / budget / regime / market-open are *veto* conditions — they multiply or zero the Signal. A closed market should not silently subtract from a screening score; it should gate the timing signal.

### Mechanics (what changed)

1. **Tradability gate (Phase A)** — `marketStatus`/`liquidity` gate first: market closed → Signal composite `0` regardless of raw conviction.
2. **No constant floors (Phase B)** — removed the flat `HOLD_FLOOR`/`ENTRY_THRESHOLD` constants; thresholds are now percentage-based against each protocol's own max.
3. **Gate-vs-score refactor (Phase C)** — directive groups are now classified, and each directive result carries `signalClass`. `Opportunity = Σ all`, `Signal = Σ directional-only`, with `inSignal` flags persisted per directive.

### Persistence & UI

- `Score.breakdown` JSON now persists `rawComposite`, `rawMax`, `opportunityScore`, `opportunityMax`.
- Registry: both scores shown with tooltips explaining the "why".
- Symbols Ladder: a **Score: Signal / Opportunity** toggle (+ sort "By Opportunity"), and a per-row "Market closed / frozen" pill when gated.
- Protocol Trail: per-directive "condition" badge marks which directives contributed to the *Signal* (vs Opportunity-only).

### Known follow-up (flagged, not yet requested)

The **Signal denominator is dynamic** — it wobbles (e.g. 125 / 170 / 270) depending on which directional directives fire. That is by design for now, but a **stable denominator** (score against the protocol's full directional ceiling) is the natural next refinement if the wobble confuses users.

Design doc: `docs/scoring-architecture.md`.
