---
description: "Implement the Bitcoin Speed Protocol (BTC-SPEED-V1) with variable-weight directives, crypto-specific unstubbing, and the speed-momentum directive. Use when: building the Bitcoin protocol, creating crypto directives, or wiring a new protocol into scoring."
argument-hint: "All directives or start with unstubbing crypto ones?"
appliesTo: "nest/src/modules/directives/**, nest/src/modules/scoring/**"
---

# Bitcoin Speed Protocol — Implementation

## Background
See `docs/BTC-SPEED-PROTOCOL-THEORY.md` for the full theory. This prompt covers the implementation of the Bitcoin Speed Protocol with deliberate variable maxScore weights, unstubbing crypto directives, and creating the new `speed-momentum` directive.

## Task 1: Unstub Crypto Directives

Three crypto directives are placeholder stubs in `placeholder-directives.stub.ts`. Replace them with real implementations.

### 1a. `crypto-fear-greed` (maxScore: 60)
- **Data source:** Free [Alternative.me Crypto Fear & Greed Index API](https://api.alternative.me/fng/) — no API key needed
- **Logic:**
  - Fetch current value (0-100, where 0=Extreme Fear, 100=Extreme Greed)
  - Score = contrarian: `abs(value - 50) × 1.2`, capped at 60
  - Extreme Fear (<25) → bullish signalClass, score ~30-60
  - Extreme Greed (>75) → bearish signalClass, score ~30-60
  - Neutral (25-75) → neutral signalClass, score 0-30
- **Caching:** Cache result for 1 hour (API updates hourly)
- **Suitability:** Only applies to `instrumentTypes: ['crypto']`

### 1b. `btc-halving-cycle` (maxScore: 200)
- **Data:** Hardcoded halving dates: 2012-11-28, 2016-07-09, 2020-05-11, 2024-04-20
- **Logic:**
  - Calculate days since last halving
  - 0–180 days: score = 80 + (days/180) × 120, max 200 (Post-Halving Rally)
  - 180–540 days: score = 40 − abs(days−360)/180 × 80, range 0–80 (Mid-Cycle)
  - 540–900 days: score = 20 + (days−540)/360 × 40, range 20–60 (Late-Cycle)
  - 900–1440 days: score = 20 − (days−900)/540 × 40, range 0–20 (Pre-Halving/Bear)
  - ≥1440 days: next halving assumed, reset to phase 1
- **signalClass:** Bullish in post-halving rally, neutral in mid-cycle, bearish in pre-halving
- **Suitability:** Only for `ticker: 'BTC-USD'` or `instrumentTypes: ['crypto']` where symbol contains BTC
- **Reference:** `docs/BTC-SPEED-PROTOCOL-THEORY.md` Section 3 ("The Halving Cycle")

### 1c. `crypto-weekend-effect` (maxScore: 50)
- **Logic:**
  - If current day is Saturday/Sunday: score = 30 (caution — lower volume, manipulation risk)
  - If Friday after 20:00 UTC: score = 20 (weekend approaching)
  - If Monday 00:00–08:00 UTC: score = 40 (weekend recovery opportunity)
  - Otherwise: score = 10 (neutral — weekday, normal conditions)
- **signalClass:** Neutral in all cases — this is a risk awareness directive, not directional
- **Suitability:** Only for `instrumentTypes: ['crypto']`

## Task 2: Create `speed-momentum` Directive (maxScore: 120)

This is the core speed-trading directive. It measures short-term price velocity.

### File: `nest/src/modules/directives/implementations/speed-momentum.directive.ts`

```typescript
@Injectable()
export class SpeedMomentumDirective implements IDirective {
  id = 'speed-momentum';
  name = 'Speed Momentum';
  description = 'Short-term price velocity (5-candle ROC on active timeframe)';
  maxScore = 120;
  version = '1.0.0';
  priority = 85; // High priority — core speed trading signal

  activeWindow = { start: '00:00', end: '23:59', daysOfWeek: [0,1,2,3,4,5,6] }; // 24/7 for crypto

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (!bars || bars.length < 6) {
      return { score: 0, confidence: 0, reason: 'Insufficient bars', signalClass: 'neutral' };
    }

    // Calculate 5-candle rate of change
    const latest = bars[bars.length - 1];
    const previous = bars[bars.length - 6];
    const roc = ((latest.close - previous.close) / previous.close) * 100;

    // Volume confirmation
    const recentVol = bars.slice(-5).reduce((s, b) => s + (b.volume || 0), 0) / 5;
    const olderVol = bars.slice(-10, -5).reduce((s, b) => s + (b.volume || 0), 0) / 5;
    const volRatio = olderVol > 0 ? recentVol / olderVol : 1;

    // Score: ROC magnitude × volume multiplier
    const absRoc = Math.abs(roc);
    let score = Math.min(120, absRoc * 80); // 1.5% move = 120 max
    score = Math.round(score * Math.min(2, volRatio)); // Volume can double the score

    const direction = roc > 0.1 ? 'bullish' : roc < -0.1 ? 'bearish' : 'neutral';
    const confidence = Math.min(1, absRoc / 2); // 2%+ move = full confidence

    return {
      score: Math.min(this.maxScore, score),
      confidence,
      reason: `${direction} ROC ${roc.toFixed(2)}% over 5 bars, vol ratio ${volRatio.toFixed(1)}x`,
      signalClass: direction,
    };
  }
}
```

- **Suitability:** All instrument types. Active on timeframes M1–H1.
- **Note:** Does NOT use `Math.min(100, ...)` — clamps to `this.maxScore` (120).

## Task 3: Register Protocol in `directive-groups.ts`

Add a new export to `directive-groups.ts`:

```typescript
export const BTC_SPEED_GROUPS: DirectiveGroups = {
  technical: [
    'speed-momentum',     // 120 — Core velocity signal
    'bollinger-squeeze',  // 100 — Expansion catalyst
    'volume-confirmation',//  85 — Volume support
    'atr-expansion',      // 100 — Vol opportunity
    'rsi-oversold',       // 120 — Oversold bounce
    'support-resistance', // 100 — Round numbers
  ],
  sentiment: [
    'crypto-fear-greed',  //  60 — Contrarian sentiment
    'news-sentiment',      // 100 — Crypto news flow
    'social-buzz',         // 100 — Social activity
  ],
  risk: [
    'btc-halving-cycle',   // 200 — Macro cycle bonus (multiplicative gate)
    'crypto-weekend-effect',// 50 — Weekend risk awareness
    'volatility-regime',    // 100 — Kill in extreme vol
    'liquidity-check',      // 100 — Spread/volume check
    'position-concentration',// 100 — Don't over-allocate
  ],
};

// Extend PROTOCOL_REGISTRY
export const PROTOCOL_REGISTRY: Record<string, ProtocolDefinition> = {
  default: { groups: DIRECTIVE_GROUPS, name: 'SEES Default', description: '...' },
  'btc-speed-v1': { groups: BTC_SPEED_GROUPS, name: 'Bitcoin Speed Scalp V1', description: '...' },
};
```

## Task 4: Extend `ProtocolGatingService` for Custom Protocols

Update `scoreWithGating()` to accept an optional protocol ID:

```typescript
async scoreWithGating(
  symbol: string,
  input: DirectiveInput,
  protocolId?: string,  // NEW
): Promise<GatedScore> {
  const groups = protocolId
    ? PROTOCOL_REGISTRY[protocolId]?.groups ?? DIRECTIVE_GROUPS
    : DIRECTIVE_GROUPS;
  // ... rest of existing logic using `groups`
}
```

Add endpoint:
```
GET /api/scoring/gated/:symbol?protocol=btc-speed-v1
```

## Task 5: Verify

After implementation, confirm:
- `GET /api/scoring/gated/BTC-USD?protocol=btc-speed-v1&timeframe=5m` returns a valid `GatedScore`
- `btc-halving-cycle` score reflects ~26 months post-halving (Late-Cycle, expecting 20-60)
- `speed-momentum` produces non-zero scores on 5m BTC bars
- `crypto-fear-greed` fetches and caches real API data
- The protocol's max possible score (~900) is correctly computed and displayed

## References
- Theory: `docs/BTC-SPEED-PROTOCOL-THEORY.md`
- Existing directives: `nest/src/modules/directives/implementations/`
- Gating service: `nest/src/modules/scoring/protocol-gating.service.ts`
- Group definitions: `nest/src/modules/directives/directive-groups.ts`
