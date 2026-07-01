# GitHub Issue: Directive Activation Gates & Conditional Suitability

## Why This Gives an Edge
A mean-reversion directive like RSI Oversold running during a strong downtrend generates false buy signals. A trend-following directive like MACD Crossover running in a ranging market produces whipsaws. Currently all 80+ directives run blindly on every symbol regardless of conditions. This is noise masquerading as signal.

## The Problem
- `rsi-oversold` produces 85-score buys during -3% down days — those are losers
- `hurst-memory` says H=0.32 (mean-reverting) but `macd-crossover` still fires trend signals
- `liquidity-sweep` works in high vol but `session-timing-filter` is in Asian session (low vol)
- Directives with conflicting worldviews fight each other, producing neutral aggregate scores that don't help

## Solution: Three-Layer Activation System

### Layer 1: Directive Suitability Tags (static metadata)
Each directive declares what conditions it works in:

```typescript
readonly suitability?: {
  regimeType: 'trending' | 'ranging' | 'any';
  volatilityLevel: 'low' | 'normal' | 'high' | 'any';
  instrumentTypes: ('forex' | 'stocks' | 'crypto' | 'indices' | 'commodities')[];
  minTimeframe: string;
  preferredSessions: ('US' | 'London' | 'Asian')[];
};
```

### Layer 2: Condition Detectors (runs first)
Before scoring, these classifiers run and produce a condition vector:
- `market-entropy` → entropy ratio (trending/ranging/chaotic)
- `hurst-memory` → H exponent (persistent/mean-reverting/random)
- `session-timing-filter` → active session + quality
- `range-contraction` → compression state
- `market-structure-bos` → directional structure

### Layer 3: Dynamic Activation Gates (runtime)
The condition vector gates each directive:

```
IF regime = 'trending' AND directive.regimeType = 'ranging'
  → MUTE directive (score=0, pass-through)

IF session = 'Asian' AND directive.preferredSessions = ['US','London']
  → REDUCE weight by 50%

IF volatility = 'high' AND directive.volatilityLevel = 'low'
  → REDUCE weight by 30%

IF trigger = 'FOMC_30min_warning'
  → MUTE all directives, flat position recommended
```

### Trigger System
Named triggers that fire on specific events:
- `FOMC_30MIN`: 30 minutes before Fed announcement → mute all
- `VXX_SPIKE_30PCT`: VXX up 30% in 1 day → activate panic exhaustion
- `BTC_VOL_5PCT_1H`: BTC moves 5% in 1 hour → boost volume directives
- `EARNINGS_TODAY`: Earnings for held symbol today → mute mean-reversion
- `FIRST_FRIDAY`: NFP day → cautious mode

## Implementation Phases

### Phase 1: Suitability Tags (Q226)
- Add `suitability` metadata to all existing directives
- Tag ~80 directives with regime, volatility, instrument, timeframe
- Frontend: show suitability badges on directive cards

### Phase 2: Activation Engine (Q225)
- Condition detector runs pre-scoring
- Dynamic weight adjustment based on condition × suitability
- Scoring pipeline gets a condition vector parameter
- Muted directives return score=0 instead of noise

### Phase 3: Trigger System (Q227)
- Named trigger definitions with conditions
- Trigger → action mapping (mute, boost, override)
- Trigger monitoring service
- Frontend: active trigger indicator in SEES Live Stack

### Phase 4: Self-Learning Gates (future)
- Track which condition×directive combinations produce accurate signals
- Use directive accuracy tracking (Q215) data
- Auto-learn optimal activation rules per symbol

## Labels
enhancement, scoring, architecture, P0

## Priority
P0 — wrong directive at wrong time = guaranteed noise. This is the difference between a scoring system and a profitable one.
