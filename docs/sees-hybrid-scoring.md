# SEES Hybrid Scoring — Base + Bonus Architecture

> Captured from architectural discussion on 2026-07-29.
> Supersedes the threshold-only scoring described in earlier SEES docs.
> This document explains **how** SEES produces scores. For **why** SEES exists, see `sees-strategy-concept.md`.

---

## The Problem

Two competing requirements for directive scoring:

| Requirement | Why It Matters |
|-------------|---------------|
| **Responsiveness** — scores must reflect every market move | User sees a frozen dashboard → assumes the system is broken |
| **Separation** — the ladder must distinguish strong signals from noise | If everything scores ~50, the ranking is meaningless |

**Threshold-only scoring** (the current implementation) satisfies separation but fails responsiveness. A directive like `rsi-oversold` returns score=6 for 95% of bars (RSI in neutral zone) and suddenly jumps to 85 when RSI crosses 30. The user checks the dashboard 50 times and sees "6, 6, 6, 6, 6…" — then misses the one moment it changes.

**Continuous-only scoring** would satisfy responsiveness but fail separation. If RSI linearly maps to score, every symbol hovers around 50 and the ladder never separates leaders from laggards.

## The Solution: Hybrid Base + Bonus

Every directive produces a score with **two independent components**:

```
┌────────────────────────────────────────────────────────────┐
│  DIRECTIVE SCORE = BASE (continuous) + BONUS (threshold)   │
│                                                            │
│  BASE:    Reflects every tick of market movement.          │
│           Linear interpolation across the neutral zone.    │
│           Range: roughly 0–50 for most directives.         │
│           Always moving. User always sees change.          │
│                                                            │
│  BONUS:   Fires only at rare thresholds.                   │
│           Large but infrequent. Creates ladder separation.  │
│           Multiple tiers: mild, strong, extreme.            │
│           Example: RSI < 30 → +30, RSI < 20 → +50,         │
│                    RSI < 10 → +80                           │
│                                                            │
│  MAX:     Uncapped per directive. A directive can declare   │
│           maxScore=200 if its signal is high-conviction.    │
│           Protocol can override: directiveMaxScores.        │
└────────────────────────────────────────────────────────────┘
```

### Concrete Example: `rsi-oversold`

```
Base calculation (always active):
  mapRange(RSI, 70, 30, 0, 50)   ← linear interpolation
  RSI 43.3 → base = 33.4
  RSI 43.4 → base = 33.3          ← user sees the 0.1 change
  RSI 30.0 → base = 50.0

Bonus tiers (threshold-gated):
  RSI < 30  → +30  (1.5σ event, ~7% of bars)
  RSI < 25  → +50  (2σ event,   ~2% of bars)
  RSI < 20  → +80  (3σ event,   ~0.1% of bars)

Resulting scores:
  RSI 43.3:  base=33 + bonus=0   → total=33/130   (neutral, expected)
  RSI 28.0:  base=52 + bonus=30  → total=82/130   (stands out on ladder)
  RSI 18.0:  base=65 + bonus=80  → total=145/130  (exceeds max — extreme signal)
```

### Why Uncapped Max Scores

The `maxScore` on a directive is not a hard ceiling — it's the score that a directive produces under **normal** conditions. An extreme event (RSI at 18 during a panic) can exceed maxScore. This is intentional:

- The SEES Ladder is a **relative** ranking — what matters is that one symbol scores higher than another
- Exceeding maxScore means "this signal is so rare it breaks the normal scoring model"
- Other directives in the protocol are NOT capped either — the composite naturally reflects unusual conditions

### Per-Protocol Tuning

The same directive can carry different weight in different protocols:

```json
// In xau-speed-v1 (gold scalp):
"directiveMaxScores": {
  "rsi-oversold": 90    // Gold trends — mean-reversion is less reliable
}

// In conviction-dip (equity mean-reversion):
"directiveMaxScores": {
  "rsi-oversold": 150   // Equities mean-revert — RSI oversold is core signal
}
```

This per-protocol configurability is the **evolution mechanism**. A protocol starts with default directive weights. As you trade it, you observe which directives produce the best signals, then tune their maxScores up (more weight) or down (less weight). The protocol evolves without changing any directive code.

## Relationship to Group Weighting

SEES protocols group directives into categories (Technical, Sentiment, Risk) with group-level weights:

```
Protocol "conviction-dip":
  Technical group:    weight 0.40  (RSI, MACD, EMA, ATR, Volume)
  Sentiment group:    weight 0.35  (News, Analyst, Earnings)
  Risk group:         multiplier   (Budget, Liquidity, Correlation)
```

The hybrid scoring operates **within** each directive independently. The group weighting happens **after** — aggregating directive scores into group percentages, then combining groups. A directive's base+bonus score is its raw contribution before group weighting.

## Implementation Scope

This change is **surgical, not architectural**:

| Layer | Change Required |
|-------|----------------|
| `IDirective` interface | No change — already supports `maxScore` and returns `score: number` |
| Directive `calculate()` | Split logic into base + bonus. ~25 real directives affected. |
| Protocol config | Already supports `directiveMaxScores` overrides. No schema change. |
| Scoring pipeline | Already normalizes scores against maxScores. No change. |
| Database schema | Scores stored as numbers. No migration needed. |
| UI / API | Already consumes `{ score, maxScore }`. Numbers become more granular. |

## Readiness Tiers Applied to Scoring

See `readiness-tiers.md` for the full policy. Applied to scoring:

| Tier | Scoring Behavior |
|------|-----------------|
| **ALPHA** | Directive returns mock-neutral (score=50). Excluded from composite. |
| **BRAVO** | Directive computes real base score but bonus tiers may be uncalibrated. Included in composite with reduced weight. |
| **READY** | Full hybrid scoring active. Base + bonus both calibrated against live data. Full weight. |

A protocol's composite only includes READY and BRAVO directives. ALPHA directives are listed in the breakdown with a "mock — excluded from composite" flag. This prevents mock directives from dragging the composite toward 50.
