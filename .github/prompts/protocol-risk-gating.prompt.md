---
description: "Build a protocol-level Risk Gating system — group directives into Technical, Sentiment, and Risk categories where high-risk directives multiplicatively gate lower-priority ones. Use when: building the meta-directive layer, implementing risk-aware scoring, or after having 8+ working directives that need structured interaction."
argument-hint: "Which directive categories to define?"
---
Build a protocol-level Risk Gating system — directives don't just add up, they interact.

## The Problem

Current SEES protocol: all directives contribute independently. A stock with catastrophic structural risk but great RSI gets a pass because the good score drowns out the bad.

```
MSTR today:
  Analyst consensus:  +15  (great)
  RSI oversold:        +8  (bouncing)
  Dilution risk:      -10  (structural)
  BTC correlation:    -10  (systemic)
  ─────────────────────────
  Score: 53 → HOLD   ← Wrong. Risk should dominate.
```

## The Solution: Directive Groups with Multiplicative Gating

### Group Architecture

```
Directive Groups
├── 📊 TECHNICAL  (weight: 0.40)     — Price action, momentum, patterns
│   ├── RSI Oversold
│   ├── MACD Crossover
│   ├── EMA Structure
│   ├── Volume Confirmation
│   └── Momentum ROC
│
├── 💬 SENTIMENT  (weight: 0.35)     — Analyst, news, social, fundamentals
│   ├── Analyst Adjustments
│   ├── News Sentiment
│   ├── Earnings Proximity
│   └── Social Media Buzz
│
└── ⚠️ RISK        (weight: 0.25)    — Structural, correlation, concentration
    ├── Position Concentration
    ├── Correlation Drag (BTC/MSTR, CAD/USD oil, etc.)
    ├── Dilution Impact
    ├── Volatility Regime
    └── Liquidity Check
```

### Scoring Formula

```
Step 1: Group Sub-Scores
  technicalScore = Σ(technical directive scores × normalized weights)
  sentimentScore = Σ(sentiment directive scores × normalized weights)
  riskScore      = Σ(risk directive scores × normalized weights)

Step 2: Risk Gate (multiplicative, not additive)
  riskMultiplier = riskScore / 100        // 0.0 – 1.0
  If riskScore < 30:  riskMultiplier = 0.3  // Hard floor: risk never zeroes out
  If riskScore > 80:  riskMultiplier = 1.2  // Low risk can boost

Step 3: Composite
  rawComposite = (technicalScore × 0.40 + sentimentScore × 0.35) × riskMultiplier
  // Risk is never added — it only modulates what Technical + Sentiment produce

Step 4: Signal
  composite >= 65 → BUY
  composite 35-64 → HOLD
  composite < 35  → SELL / AVOID
```

### MSTR Example (with gating)

```
Technical:  58  (price recovering from dip, volume elevated)
Sentiment:  80  (88% analysts bullish, but news is negative — diluted)
Risk:       25  (dilution -10, BTC correlation -10, concentration -5)

Old (additive):     (58 + 80 + 25) / 3 = 54 → HOLD
New (multiplicative): (58×0.40 + 80×0.35) × (25/100)
                    = (23.2 + 28.0) × 0.25
                    = 51.2 × 0.25
                    = 12.8 → SELL / AVOID ✅
```

The gating catches what additive misses: **MSTR's risk profile is too poor to hold, regardless of analyst consensus.**

---

## Implementation

### 1. DirectiveGroup Registry
`nest/src/modules/directives/directive-groups.ts`:

```typescript
export interface DirectiveGroup {
  id: string;
  name: string;
  description: string;
  weight: number;          // Weight in final composite
  isRiskGate: boolean;     // Does this group act as a multiplier?
  minMultiplier: number;   // Hard floor for risk gate (e.g. 0.3)
  maxMultiplier: number;   // Cap for low-risk boost (e.g. 1.2)
  directiveIds: string[];  // Which directives belong
}

export const DIRECTIVE_GROUPS: DirectiveGroup[] = [
  {
    id: 'technical',
    name: 'Technical Analysis',
    description: 'Price action, momentum, patterns, volume',
    weight: 0.40,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: ['rsi-oversold', 'macd-crossover', 'ema-structure', 'volume-confirmation', 'momentum-roc'],
  },
  {
    id: 'sentiment',
    name: 'Sentiment & Fundamentals',
    description: 'Analyst consensus, news, earnings, social',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: ['analyst-adjustments', 'news-sentiment', 'earnings-proximity', 'social-buzz'],
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    description: 'Correlation, dilution, concentration, volatility, liquidity',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,    // Worst risk = 30% of signal survives
    maxMultiplier: 1.2,    // Best risk = 20% boost
    directiveIds: ['position-concentration', 'correlation-drag', 'dilution-impact', 'volatility-regime', 'liquidity-check'],
  },
];
```

### 2. Protocol Gating Service
`nest/src/modules/scoring/protocol-gating.service.ts`:

```typescript
@Injectable()
export class ProtocolGatingService {
  constructor(
    private readonly directivesService: DirectivesService,
    private readonly scoringService: ScoringService,
  ) {}

  async scoreWithGating(symbol: string, bars: MarketBar[]): Promise<GatedScore> {
    const input: DirectiveInput = { symbol, bars };

    // 1. Run ALL directives
    const allResults = await this.directivesService.runAll(input);

    // 2. Group results
    const groups = new Map<string, { scores: DirectiveResult[]; config: DirectiveGroup }>();
    for (const group of DIRECTIVE_GROUPS) {
      const groupScores = group.directiveIds
        .map((id) => allResults.find((r) => r.directiveId === id))
        .filter(Boolean) as DirectiveResult[];
      groups.set(group.id, { scores: groupScores, config: group });
    }

    // 3. Compute group sub-scores (normalized within group)
    const subScores: Record<string, number> = {};
    const breakouts: Record<string, DirectiveBreakout[]> = {};

    for (const [groupId, { scores, config }] of groups) {
      if (scores.length === 0) {
        subScores[groupId] = 50; // Neutral default
        continue;
      }
      // Average of directive scores, normalized to directive maxScore
      const normalized = scores.map((s) => (s.score / s.maxScore) * 100);
      const avg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
      subScores[groupId] = Math.round(avg);
      breakouts[groupId] = scores.map((s) => ({
        directiveId: s.directiveId,
        score: s.score,
        maxScore: s.maxScore,
        signalClass: s.signalClass,
        reason: s.reason,
      }));
    }

    // 4. Apply risk gate
    const riskScore = subScores['risk'] ?? 50;
    const riskGroup = DIRECTIVE_GROUPS.find((g) => g.id === 'risk')!;
    let riskMultiplier = riskScore / 100;

    // Apply floor/ceiling
    if (riskMultiplier < riskGroup.minMultiplier) {
      riskMultiplier = riskGroup.minMultiplier;
    } else if (riskMultiplier > riskGroup.maxMultiplier) {
      riskMultiplier = riskGroup.maxMultiplier;
    }

    // 5. Compute composite
    const technicalContribution = (subScores['technical'] ?? 50) * 0.40;
    const sentimentContribution = (subScores['sentiment'] ?? 50) * 0.35;
    const rawComposite = (technicalContribution + sentimentContribution) * riskMultiplier;

    const composite = Math.round(Math.max(0, Math.min(100, rawComposite)));
    const signal = composite >= 65 ? 'BUY' : composite >= 35 ? 'HOLD' : 'SELL';

    return {
      symbol,
      composite,
      signal,
      subScores,
      riskMultiplier: Number(riskMultiplier.toFixed(2)),
      breakouts,
      gatingActive: true,
      meta: {
        additiveEquivalent: Math.round(
          (subScores['technical'] + subScores['sentiment'] + riskScore) / 3
        ),
        gatingDelta: composite - Math.round(
          (subScores['technical'] + subScores['sentiment'] + riskScore) / 3
        ),
      },
    };
  }
}
```

### 3. API

```typescript
@Get('scoring/gated/:symbol')
async getGatedScore(@Param('symbol') symbol: string) {
  const bars = await this.marketDataService.getBars(symbol, '1d', 100);
  return this.protocolGating.scoreWithGating(symbol, bars);
}

@Get('scoring/gated/portfolio')
async getPortfolioGated() {
  const positions = await this.portfolioService.getPositions();
  return Promise.all(positions.map(async (p) => {
    const bars = await this.marketDataService.getBars(p.symbol, '1d', 100);
    return this.protocolGating.scoreWithGating(p.symbol, bars);
  }));
}
```

### 4. Response Shape

```json
{
  "symbol": "MSTR",
  "composite": 13,
  "signal": "SELL",
  "subScores": {
    "technical": 58,
    "sentiment": 80,
    "risk": 25
  },
  "riskMultiplier": 0.30,
  "breakouts": {
    "technical": [
      {"directiveId": "rsi-oversold", "score": 65, "signalClass": "bullish", "reason": "RSI 28 — oversold bounce likely"},
      {"directiveId": "volume-confirmation", "score": 50, "signalClass": "neutral", "reason": "Volume elevated but no clear direction"}
    ],
    "risk": [
      {"directiveId": "dilution-impact", "score": 10, "signalClass": "bearish", "reason": "$100M new shares diluting existing holders"},
      {"directiveId": "correlation-drag", "score": 15, "signalClass": "bearish", "reason": "0.82 BTC correlation — systemic not idiosyncratic"}
    ]
  },
  "meta": {
    "additiveEquivalent": 54,
    "gatingDelta": -41
  }
}
```

---

## New Directives This Requires

The risk group needs directives that don't exist yet:

| Directive | What It Measures | Data Source |
|-----------|-----------------|-------------|
| `position-concentration` | Is one position > 20% of portfolio? | Position table |
| `correlation-drag` | Is this stock 80%+ correlated to an external factor? | Needs correlation calc (MarketBar history) |
| `dilution-impact` | Is the company issuing shares? Share count growing? | Finnhub fundamentals or FMP |
| `volatility-regime` | Is volatility expanding or contracting? | ATR from MarketBar |
| `liquidity-check` | Is volume sufficient to exit position? | Volume from MarketBar |

## Protocol Upgrade Path

```
Phase 1: Groups defined, weights static
Phase 2: Weights calibrated per symbol (like SymbolCalibration but for groups)
Phase 3: Dynamic risk multiplier based on portfolio context
Phase 4: Machine-learned group weights from backtest results
```

## Related
- `add-analyst-forecast-sources.prompt.md` — sentiment group needs live analyst data
- `normalize-and-auto-refresh.prompt.md` — risk group needs live price/volume data
- `portfolio-session-tracking.prompt.md` — position concentration needs portfolio history
- `stock-investigation-system.prompt.md` — investigations feed the risk narrative
