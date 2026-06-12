# Canonical Directive Reference

> **THIS IS THE SINGLE SOURCE OF TRUTH.** All agents, contracts, and implementations must reference this file.
> If you find a mismatch between this file and any other file, this file wins. Report mismatches.

---

## The Five MVP Directives

These are the ONLY directives in scope for MVP. The IDs below are canonical.

| ID | Name | Type | Rule |
|---|---|---|---|
| `rsi-oversold` | RSI Oversold Reversion | Momentum / Mean Reversion | Bullish when RSI(14) < 30 and curling upward |
| `macd-crossover` | MACD Bullish Crossover | Trend / Momentum Shift | Bullish when MACD line crosses above signal line |
| `ema-structure` | Price Above EMA Structure | Trend Alignment | Stronger when price > EMA20 > EMA50 |
| `atr-dip` | ATR Normalized Dip | Volatility / Pullback Quality | Favors dips that are significant but not breakdown-level |
| `volume-confirmation` | Volume Confirmation | Participation Filter | Bullish setups score higher with volume support |

## The MVP Strategy

**Name**: Conviction Dip Accumulation  
**Type**: Soft long-only, share-buying  
**Behavior**: Accumulate on quality dips; hold through normal drawdown; avoid panic exits  
**Goal**: Improve buy timing, not maximize turnover

### Strategy Thresholds

| Threshold | Value | Meaning |
|---|---|---|
| `entryThreshold` | 60 | Score ≥ 60: Entry signal |
| `watchThreshold` | 40 | Score ≥ 40: Watchlist candidate |
| `defenseThreshold` | 25 | Score ≥ 25: Defensive hold; < 25: Active concern |

### Directive Weights (sum = 100)

| Directive ID | Weight |
|---|---|
| `rsi-oversold` | 24 |
| `macd-crossover` | 22 |
| `ema-structure` | 20 |
| `atr-dip` | 18 |
| `volume-confirmation` | 16 |

## The Directive Contract

Every directive MUST return exactly this shape. Nothing more.

```typescript
interface DirectiveResult {
  score: number;      // 0–100
  confidence: number; // 0–1
  reason: string;     // Human-readable explanation
}
```

**No boost. No multiplier. No "moments."** The aggregate score is a simple weighted average:

```
totalScore = Σ(directive.score × directive.weight / 100)
```

Score range: **0–100**. Capped. Not uncapped.

## Required Per-Response Metadata

Every scoring response MUST include:
1. **Signal horizon** — e.g. "short swing", "multi-day", "position"
2. **Data timeframe used** — e.g. "1h bars", "daily bars"
3. **Timeframe mismatch warning** — when data timeframe doesn't match intended hold period

## What Is NOT In MVP Scope

- ❌ Panic Exhaustion Absorption (d03)
- ❌ Overhead Supply Pressure (d04)
- ❌ "Significant moments" with boost/multiplier (breakout-acceleration, broad-risk-on, quality-carry, reversion-risk)
- ❌ Abstract directive names (trend, momentum, volatility, breadth, conviction)
- ❌ Uncapped scores above 100
- ❌ Short/aggressive strategies

## File Mapping

| Canonical ID | NestJS Implementation | Status |
|---|---|---|
| `rsi-oversold` | `nest/.../implementations/rsi-oversold.directive.ts` | ✅ Implemented |
| `macd-crossover` | `nest/.../implementations/macd-crossover.directive.ts` | ✅ Implemented |
| `ema-structure` | `nest/.../implementations/ema-structure.directive.ts` | ✅ Implemented |
| `atr-dip` | `nest/.../implementations/atr-dip.directive.ts` | ✅ Implemented |
| `volume-confirmation` | `nest/.../implementations/volume-confirmation.directive.ts` | ✅ Implemented |

**The React `sees-engine.js` is a local simulation engine, not the production directive engine.** Its abstract directive names (trend, momentum, etc.) and boost/multiplier system are simulation-only and must not influence the backend directive specification.

---

*Last updated: 2026-06-11. Updated status from PLACEHOLDER to Implemented — all 5 directives have real indicator math as of Task 4 completion (verified Q09).*
