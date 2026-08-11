# Directive Scoring Architecture

> **Status:** Design doc — evolving  
> **Last updated:** 2026-08-11  
> **GitHub Issue:** [#608](https://github.com/FifeCIC/Trading-Command-Suite/issues/608)

---

## Core Formula

```
Score = weightPortion + rawFeedback
```

| Component | Type | Purpose | Example (RSI=5, bullish, weight=140) |
|-----------|------|---------|------|
| **weightPortion** | Math | Rewards the perfect market moment. Derived from Weight × curve(marketValue). | 140 × 1.0 = 140 |
| **rawFeedback** | Numeric | The indicator's current reading. Constant micro-movement every tick. Confirms the directive is alive. | 5 |
| **Total** | | | **145** |

### Curve function

```javascript
// For bullish (scores high when value is LOW):
weightPortion = weight × (1 − value/scaleMax)^steepness

// For bearish (scores high when value is HIGH):
weightPortion = weight × (value/scaleMax)^steepness

// With floor — never returns < minScore (typically 1):
weightPortion = Math.max(minScore, weightPortion)
```

### Variables the user can adjust

| Variable | Meaning | Stored in | Example |
|----------|---------|-----------|---------|
| `weight` | Maximum score this directive can award for perfect conditions | DB key-value | 140 |
| `scaleMax` | The indicator's ceiling value | DB key-value | 80 (RSI), 1.5 (VI) |
| `steepness` | How aggressively weight concentrates at extremes | DB key-value | 1.5–2.0 |
| `minScore` | Floor value — always returns at least this | DB key-value | 1 |
| `directionBias` | Whether the directive is bullish, bearish, or neutral | Directive class | 'bullish' |

---

## Directive Categories

### Category 1 — Oscillator (bounded scale)

**Fits the curve formula.** Has a known maximum value (0–80, 0–100, 0.5–1.5).

| Directive | Scale Max | Direction |
|-----------|-----------|-----------|
| RSI (oversold) | 80 | bullish |
| RSI (overbought) | 80 | bearish |
| CCI | 100 | bearish |
| Stochastic | 100 | neutral |
| MFI | 100 | neutral |
| Williams %R | 100 | bearish |
| Volatility Index | 1.5 | neutral |
| Bollinger %B | 1.0 | neutral |
| ADX | 100 | neutral |

**Template:**
```typescript
readonly category = 'oscillator';
readonly weight = 100;        // DB-overridable
readonly scaleMax = 80;       // DB-overridable
readonly steepness = 2.0;     // DB-overridable

calculate(input: DirectiveInput): DirectiveResult {
  const value = this.getIndicatorValue(input.bars);
  const pct = Math.pow(1 - value / this.scaleMax, this.steepness);
  const weightPortion = Math.max(1, Math.round(this.weight * pct));
  const score = weightPortion + Math.round(value);
  return { score, confidence: ..., reason: ... };
}
```

### Category 2 — Ratio / Unbounded

**No fixed scale.** Uses hardcoded branch thresholds. Ratio can spike unpredictably (A/D ratio, volume surge ratio).

| Directive | Type |
|-----------|------|
| accumulation-dist | A/D ratio trend |
| accumulation-distribution | A/D ratio |
| volume-surge | Volume ratio |
| gap-scanner | Gap size ratio |

**Template:**
```typescript
readonly category = 'ratio';

calculate(input: DirectiveInput): DirectiveResult {
  const ratio = this.computeRatio(input.bars);
  // Hardcoded branches based on ratio thresholds
  if (ratio > 0.3) return { score: this.weight, ... };
  if (ratio > 0)   return { score: Math.round(this.weight * 0.7), ... };
  // ...
}
```

### Category 3 — Pattern / Binary

**Detects a specific formation or event.** Returns a flat score or zero. No scale, no curve.

| Directive | Type |
|-----------|------|
| doji-pattern | Candlestick pattern |
| engulfing-pattern | Candlestick pattern |
| hammer-pattern | Candlestick pattern |
| fair-value-gap | ICT pattern |
| santa-claus-rally | Calendar event |
| january-effect | Calendar event |
| election-cycle | Calendar event |

**Template:**
```typescript
readonly category = 'pattern';

calculate(input: DirectiveInput): DirectiveResult {
  const detected = this.detect(input.bars);
  if (detected) return { score: this.weight, confidence: detected.confidence, ... };
  return { score: this.minScore, confidence: 0.1, reason: 'No pattern detected' };
}
```

### Category 4 — Structural / Gate

**Risk gates, budget checks, structural analysis.** Not scored for signal — they gate or modify other scores.

| Directive | Type |
|-----------|------|
| budget-gate | Risk gate |
| liquidity-check | Risk gate |
| market-regime | Structural |
| market-structure-bos | Structural |

**Template:**
```typescript
readonly category = 'structural';
readonly isRiskGate = true;

calculate(input: DirectiveInput): DirectiveResult {
  // Returns a modifier or gate status, not a signal score
}
```

---

## Decision Tree (per directive audit)

```
Is there a bounded indicator scale (0–X)?
  YES → Category 1 (Oscillator) — use curve formula
  NO  → Does it detect a specific pattern/event?
           YES → Category 3 (Pattern) — flat score or zero
           NO  → Does it gate risk or assess structure?
                  YES → Category 4 (Structural) — modifier, not score
                  NO  → Category 2 (Ratio) — hardcoded branches
```

---

## Audit Procedure

1. **Categorize** — which of the 4 categories?
2. **Verify** max score matches actual ceiling of `calculate()`
3. **Set directionBias** — explicit (never default/empty)
4. **Assign weight** — 70–120 default band, higher for proven indicators
5. **Add rawFeedback** — if oscillator, add the indicator's current value
6. **Define DB keys** — what the user can adjust per directive

---

## Glossary

| Term | Feature | Meaning |
|------|---------|---------|
| **Weight** | Directives | Maximum score a directive can award. Higher = more influence. Range 10–200+. Stored in DB, user-adjustable. |
| **Scale** | Directives | Indicator's native value range (RSI 0–80, VI 0.5–1.5). |
| **Score** | Scoring | Value a directive returns for current market state. 0 to Weight + ScaleMax. |
| **Brackets** | Directives | Separated ranges within a Scale. Used by Ratio/Pattern categories. Curve category uses continuous formula instead. |
| **Branches** | Code | If/else paths inside `calculate()`. |
| **Steepness** | Curve formula | How aggressively weight concentrates at scale extremes. 1.0=linear, 2.0=quadratic, 3.0=exponential. |
| **rawFeedback** | Scoring | The indicator's raw current value. Added to weight portion for constant micro-movement. |
| **directionBias** | Directives, Protocols | Bullish/bearish/neutral. Protocols filter by bias. Must be explicit — never empty. |
| **minScore** | Directives | Floor value. Always returns ≥ this (typically 1). Confirms the directive is alive. |
| **Category** | Directives | oscillator, ratio, pattern, or structural. Determines which scoring template to use. |
