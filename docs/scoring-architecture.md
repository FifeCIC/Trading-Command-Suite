# Scoring Architecture — Dual-Score Model

> **Status:** Live (2026-08-16) · **Source of truth:** `nest/src/modules/scoring/protocol-gating.service.ts`
> **GitHub Issue:** [#638](https://github.com/FifeCIC/Trading-Command-Suite/issues/638) "Scoring architecture: separate gates from scores"

> This document **replaces** the earlier `weightPortion + rawFeedback` draft (issue #608),
> which described an aspirational per-directive formula that was never what the code computed.

> **Correctness remediation (started 2026-09-08):** The canonical pipeline now
> separates directional evidence and score units, preserves queue lineage, and
> uses canonical scoring for replay/backtest. Some account-risk, outcome-schema,
> and full timeframe-loader work remains. Keep automated trading disabled until
> the dated ledger in [META.Stack Correctness Review](./meta-stack-correctness-review.md)
> shows every Critical item complete with pipeline regression tests.

---

## The core idea: two questions, two scores

A trading system asks **two different questions**, and they deserve **two different numbers**:

| Question | Score | Answer it gives |
|----------|-------|-----------------|
| **"Which symbol is the best opportunity?"** | **Opportunity Score** | Rank across a universe — "find the golden needle in a haystack of silver needles" |
| **"Is *now* the right moment for *this* symbol, and which way?"** | **Signal** | Timing + direction for a single symbol |

Mixing both into one number produced the old "relaxed scoring": a BUY at 42% that was mostly
noise from always-on conditions rather than genuine directional conviction.

## Non-negotiable data-flow invariants

The score model is safe only when its meaning survives every service boundary:

1. Raw score, maximum, percentage, confidence, and risk multiplier are distinct
   units. A raw score must never be persisted in a percentage field.
2. Bullish and bearish evidence remain separate until an explicit conflict/netting
   rule resolves direction. Protocol intent cannot turn bearish evidence bullish.
3. Every evaluation carries an explicit as-of time and the complete, provenance-
   tagged timeframe bundle required by its directives.
4. Missing, stale, neutral, and zero are different states and must not share a
   fallback value.
5. Queue entries reference an immutable persisted decision and every execution
   path re-runs the same fail-closed feasibility policy immediately before the
   broker call.
6. Live, API, replay, backtest, and scheduler entry points use one canonical
   evaluator and produce identical results for an identical evaluation context.

The executable test requirements for these invariants are defined in the
[META.Stack Correctness Review](./meta-stack-correctness-review.md#required-testing-system).

---

## The two scores

### 1. Opportunity Score — *"everything counts"* (selection / screening)

```
OpportunityScore = Σ (all directive raw scores)     — every group, every directive
OpportunityMax   = Σ (all directive maxScores)      — the protocol's total weight
OpportunityPct   = OpportunityScore / OpportunityMax × 100
```

- **Additive** — direction, conditions, forecasts, liquidity all contribute.
- **What it's for** — ranking attractiveness across many symbols (screening, watchlist
  ordering, "which stock deserves a closer look"). This is the original SEES vision.
- **Not a timing signal** — a high Opportunity Score says "great candidate", not "buy now".

### 2. Signal — *"directional conviction"* (timing)

```
SignalRaw = Σ (directional directive scores)        — only signalClass ∈ {bullish, bearish}
SignalMax = Σ (those directives' maxScores)         — directional denominator
SignalPct = SignalRaw / SignalMax × 100

composite = SignalRaw × risk-multiplier             — soft gates scale it
          = 0 if a hard gate vetoes (e.g. market closed, liquidity too low)
```

- **Directional only** — a directive contributes only when it is actually expressing a
  direction *right now* (`signalClass` = `bullish`/`bearish`).
- **What it's for** — timing an entry/exit. The `BUY / HOLD / SELL` classification and the
  automation loop's trade decisions use this.
- **Gated, not diluted** — risk conditions *multiply* the signal; they never add points.

---

## The three roles a directive can play

| Role | Examples | Where it goes |
|------|----------|---------------|
| **Direction** (additive, both scores) | `rsi-oversold`, `speed-momentum`, `support-resistance-levels`, `gold-macro-correlation`, `analyst-adjustments`, `earnings-momentum` | Opportunity numerator **and** Signal numerator |
| **Condition** (quality / magnitude — Opportunity only) | `gold-session-profile` (session quality), `bollinger-band-squeeze`, `volatility-tools`, `volume-confirmation` | Opportunity numerator **only** |
| **Gate** (multiplier / veto) | `liquidity-check`, `budget-gate`, `dxy-regime` | Neither numerator — it multiplies or vetoes the Signal |

**Rule of thumb:** if a directive answers "which way, how strongly" → it's a **Direction**.
If it answers "is now a good / quality / tradeable moment" → it's a **Condition** or **Gate**.

The runtime marker is the directive's `signalClass`:
- `bullish` / `bearish` → contributes to the Signal.
- `neutral` → contributes to the Opportunity only (it's a condition/gate, not a direction).

---

## Why this design (the "why" for users)

1. **Selection ≠ timing.** Institutional investing separates *what to own* (security
   selection) from *when* (market timing). SEES was trying to do both in one number, which
   made it muddy. Now they are two explicit, labelled numbers.
2. **Conditions matter — but not as directional points.** Liquidity, session quality and
   volatility are real inputs. They tell you *how good a moment is*, not *which way price
   moves*. Adding them to a directional number was the noise floor.
3. **A strategy configures the recipe.** The signalling layer (scoring strategies) decides
   how to combine them, e.g.:
   - `Opportunity ≥ 70 AND Signal = BUY` → enter (strict).
   - `rank by Opportunity, enter on the first BUY Signal` → screen-then-time.
   - Opportunity only → pure screener. Signal only → pure timing on a fixed watchlist.

---

## History of the change (Phase A → C, GH #638)

- **Phase A — tradability gate.** Added `computeMarketStatus()` (market open/closed from
  bar freshness) and made `liquidity-check` return 0 on stale data, so a closed market no
  longer scored 100/100 "highly liquid". Fixed synthetic-bar flooding in `BarRefreshService`.
- **Phase B — no constant floors.** A directive with no signal returns 0. Fixed
  `gold-round-numbers` (50-midpoint → 0-centred signed scale), `support-resistance-levels`,
  `gold-session-profile`, `obv`, and unused stubs.
- **Phase C — gate-vs-score split (dual-score model).** The composite was rebuilt as the
  directional **Signal**, the risk gate now actually multiplies, and the original additive
  total was restored as the **Opportunity Score** alongside it.

---

## Where each number appears in the UI

| Surface | Shows |
|---------|-------|
| **Symbols Ladder** | Toggle between **Signal** and **Opportunity** via the "Score:" filter; order by either |
| **Protocols Registry** | "Most Recent Scores" shows **Signal** and **Opportunity** side by side, labelled |
| **Protocol Trail** | Summary shows **Signal** and **Opportunity**; directives marked **"condition"** when they contribute to Opportunity only |
| **Automation loop** | Uses the **Signal** composite for trade decisions (gated to 0 when the market is closed) |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Composite** | The final gated Signal number (`SignalRaw × risk-multiplier`, 0 on a hard gate). |
| **rawComposite** | The pre-gate directional Signal (`SignalRaw`), used for display. |
| **Opportunity Score** | The additive "everything counts" total, used for ranking/screening. |
| **inSignal** | Per-directive flag in the breakdown: `true` = counted in the Signal, `false` = condition/gate (Opportunity only). |
| **signalClass** | Runtime direction of a directive: `bullish` / `bearish` / `neutral`. Drives Signal inclusion. |
| **directionBias** | Declared bias of a directive (bullish/bearish/neutral). Used for protocol-direction filtering. |

## Change guard — 2026-09-08

- `ProtocolGatingService` is the only action-producing score implementation.
  `ScoringService.rankAll()` is a legacy analytics surface, not a fallback.
- Backtest, replay, schedulers, and protocol runners must supply a real protocol
  and the evaluated market-data window. Never recover from an error by running
  all directives or reading a current score.
- Compare execution thresholds with unrounded `signalPct`. Round percentages only
  at display boundaries. `composite` remains risk-adjusted raw points.
- A `neutral` directive bias means dynamically two-sided eligibility; its emitted
  `signalClass` remains bullish or bearish and requires mirror tests.
- A risk gate may be marked `ready` only when its authoritative account/broker
  input is present in `DirectiveInput` and covered by boundary truth-table tests.
