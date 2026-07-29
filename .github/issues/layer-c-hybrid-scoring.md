## Problem

Directive scoring uses threshold-only logic. Example: `rsi-oversold` returns score=6 for 95% of bars (RSI in neutral zone 30-70), then suddenly jumps to 85 when RSI crosses 30. The user checks the dashboard 50 times and sees "6, 6, 6, 6, 6…" — then misses the one moment it changes. The dashboard looks frozen and the user assumes the system is broken.

Conversely, pure continuous scoring (linear map RSI→score) would make every symbol hover around 50, destroying ladder separation.

## Solution: Hybrid Base + Bonus Scoring

Every directive produces a score with TWO independent components:

```
DIRECTIVE SCORE = BASE (continuous) + BONUS (threshold)

BASE:    Reflects every tick of market movement.
         Linear interpolation across the neutral zone.
         Range: ~0–50 for most directives.
         Always moving → user always sees change.

BONUS:   Fires only at rare thresholds.
         Large but infrequent → creates ladder separation.
         Multiple tiers: mild (+30), strong (+50), extreme (+80).

MAX:     Uncapped per directive. A directive can declare maxScore=200.
         Protocol can override via directiveMaxScores.
```

### Example: `rsi-oversold`

```
Base:  mapRange(RSI, 70, 30, 0, 50)   ← continuous, always updates
       RSI 43.3 → base = 33.4
       RSI 43.4 → base = 33.3          ← user sees 0.1 change every tick

Bonus: RSI < 30 → +30  (1.5σ, ~7% of bars)
       RSI < 25 → +50  (2σ,   ~2% of bars)  
       RSI < 20 → +80  (3σ,   ~0.1% of bars)

Result:
  RSI 43.3:  base=33 + bonus=0  → total=33/130  (neutral, normal)
  RSI 28.0:  base=52 + bonus=30 → total=82/130  (stands out on ladder!)
  RSI 18.0:  base=65 + bonus=80 → total=145/130 (exceeds max — extreme signal)
```

### Per-Protocol Tuning

The same directive carries different weight in different protocols:

```json
// Gold scalp — gold trends, mean-reversion less reliable
"directiveMaxScores": { "rsi-oversold": 90 }

// Equity mean-reversion — RSI oversold is core signal  
"directiveMaxScores": { "rsi-oversold": 150 }
```

## Scope — Surgical, Not Architectural

This change touches only the `calculate()` method of real directives (~25 files). No migration, no schema change, no API contract change.

| Layer | Change Required |
|-------|----------------|
| IDirective interface | No change (already has maxScore, returns score: number) |
| Directive calculate() | Split into base + bonus. ~25 real directives. |
| Protocol config | Already has directiveMaxScores overrides |
| Scoring pipeline | Already normalizes against maxScores |
| Database | Scores stored as numbers — no migration |
| UI / API | Already consumes { score, maxScore } |

## Tasks

### Phase 1 — Foundation
- [ ] Define base interpolation formula per directive type (oscillator, trend, volatility, pattern)
- [ ] Define bonus tier thresholds per directive (1.5σ, 2σ, 3σ)
- [ ] Add bonus metadata to DirectiveResult: `{ baseScore, bonusScore, bonusTier }`
- [ ] Document the hybrid model in `docs/sees-hybrid-scoring.md` ✅ (already done)

### Phase 2 — Convert Directives (~25 real ones)
- [ ] Oscillator directives: RSI Oversold, RSI Overbought, Stochastic, CCI, MFI
- [ ] Trend directives: EMA Structure, MA Crossover, MACD Crossover, ADX
- [ ] Volatility directives: Bollinger Bands, Bollinger Squeeze, ATR Dip, Volatility Envelope
- [ ] Pattern directives: Doji, Hammer, Engulfing, Pin Bar
- [ ] Gold-specific: Gold Round Numbers, Gold Session Profile, Gold Macro Correlation
- [ ] Risk: Budget Gate, Liquidity Check, Rollover Risk

### Phase 3 — Protocol Tuning
- [ ] Add per-protocol directiveMaxScores defaults for each protocol
- [ ] Document tuning process: start default → observe → adjust weights

### Phase 4 — Verification
- [ ] Backtest: compare old threshold-only vs new hybrid scores over 200 bars
- [ ] Verify ladder separation maintained (READY symbol still outranks neutral)
- [ ] Verify score movement on every tick (no frozen dashboard)

## Docs

- `docs/sees-hybrid-scoring.md` — Full explanation with examples (already created)

## Related

- Layer A (#516): Directive Readiness Tiers
- Layer B: Capability Contracts & Activation Gates
