# Phase 2 — Scoring Strategies (Regime / Volatility / Session Gating)

> **Status:** Planned  
> **Labels:** `scoring`, `automation`, `strategies`  
> **Priority:** P1  

---

## Background

Protocols now score independently — directives run at full weight with no regime/volatility/session gating (that was disabled at the directive level in #608). The gating logic belongs here: at the **Scoring Strategy** layer, where decision-making context lives.

## Goal

Build a Scoring Strategy system that sits between Protocols and Trading Strategies:

```
Protocol → [score per symbol] → Scoring Strategy → [gated score] → Trading Strategy → [trade]
```

A Scoring Strategy can:
- Filter which protocols feed it
- Apply regime/volatility/session weight adjustments
- Set entry/exit thresholds
- Define position sizing rules

## Current State

- `scoring_strategy` table already exists in Prisma schema
- `AutomationLoopService` already loads scoring strategies and has a placeholder for them
- Activation gate code (regime, volatility, session) exists in `DirectivesService.evaluateGate()` but is disabled at the directive level
- The `ConditionVector` is already computed per-tick

## What Needs Building

### Phase 2a — Scoring Strategy Core

- [ ] Move `evaluateGate()` logic from `DirectivesService` to a new `ScoringStrategyService`
- [ ] Each scoring strategy links to one protocol and one watchlist
- [ ] Scoring strategy defines: `entryThreshold`, `regimeFilter`, `volatilityFilter`, `sessionFilter`, `weightMultiplier`
- [ ] Scoring strategy receives protocol scores and produces gated scores
- [ ] API: `GET/POST/PATCH /api/scoring-strategies`

### Phase 2b — UI

- [ ] Scoring Strategy management page (list, create, edit)
- [ ] Per-strategy configuration: regime/volatility/session toggles
- [ ] Throttle/pyramid controls
- [ ] Linked protocol + watchlist display

### Phase 2c — Automation Integration

- [ ] Automation loop runs scoring strategies after protocol scoring
- [ ] Gated scores flow to trading strategies
- [ ] Signal thresholds trigger trade evaluation

---

## Design Notes

- **Regime sensitivity** — the current ensemble thresholds (trending > 0.40) may be too sensitive. Start with lenient defaults and tune.
- **Per-strategy customization** — each scoring strategy can independently set its regime/volatility/session preferences. A "conservative" strategy might require trending + low vol, while an "aggressive" one accepts any regime.
- **Hurst + ADX** — these are the ensemble inputs. Hurst measures predictability (trending vs mean-reverting), ADX measures trend strength. Both already computed by `ConditionDetectorService`.

---

## Related Issues

- [#608](https://github.com/FifeCIC/Trading-Command-Suite/issues/608) — Directive maxScore audit (activation gate disabled here)
- [#609](https://github.com/FifeCIC/Trading-Command-Suite/issues/609) — Per-protocol directive config UI
