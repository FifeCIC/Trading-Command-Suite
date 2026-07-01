---
description: "Add a rarity/percentile gauge to scoring that distinguishes common strong scores from rare cyclical opportunities. Use when: designing the scoring UI, building protocol dashboards, or implementing score history tracking."
argument-hint: "Visual gauge or just API data first?"
appliesTo: "nest/src/modules/scoring/**, src/pages/**"
---

# Rarity Gauge — Percentile-Based Opportunity Classification

## Problem

A flat "≥ 65% = BUY" threshold treats all scores above 65% equally. But:
- **80% in a simple equity protocol** (ceiling 300) happens weekly — it's common
- **80% in the Bitcoin Speed Protocol** (ceiling 900) requires extraordinary convergence — it's rare
- **90% in the Bitcoin protocol** requires the halving cycle directive to fire — it happens once every 4 years

The user needs to know not just "how good is this score" but **"how unusual is this score for this protocol?"**

## Solution

Track historical composite scores per protocol and compute percentile-based rarity bands.

### 1. Score History Storage

Add a `ProtocolScoreHistory` table via Prisma or use the existing `ProtocolVersion` / `StrategyPerformance` tables:

```prisma
model ScoreSnapshot {
  id          String   @id @default(uuid()) @db.VarChar(36)
  protocolId  String   @db.VarChar(36)    // Which protocol
  symbol      String   @db.VarChar(20)    // Which symbol
  composite   Float                       // 0-100 composite score
  signal      String   @db.VarChar(10)    // BUY / HOLD / SELL
  rarityPct   Float?                      // Computed percentile (updated in batch)
  snappedAt   DateTime @default(now())    // When this snapshot was taken

  @@index([protocolId, snappedAt])
  @@index([symbol, snappedAt])
}
```

Store one snapshot per protocol per symbol per day (or per scoring run). Keep at least 1 year of history.

### 2. Percentile Computation

Add to `ProtocolGatingService`:

```typescript
async computeRarityPercentile(
  protocolId: string,
  compositeScore: number,
): Promise<{ percentile: number; band: RarityBand; sampleSize: number }> {
  // Fetch historical scores for this protocol (last 365 days)
  const history = await this.prisma.scoreSnapshot.findMany({
    where: {
      protocolId,
      snappedAt: { gte: new Date(Date.now() - 365 * 86400000) },
    },
    select: { composite: true },
  });

  const scores = history.map(h => h.composite);
  scores.sort((a, b) => a - b);

  // Find where current score falls
  let countBelow = 0;
  for (const s of scores) {
    if (s < compositeScore) countBelow++;
  }

  const percentile = scores.length > 0
    ? Math.round((countBelow / scores.length) * 100)
    : 50; // Not enough data — assume median

  const band = this.classifyRarityBand(percentile);

  return { percentile, band, sampleSize: scores.length };
}

private classifyRarityBand(percentile: number): RarityBand {
  if (percentile >= 99) return 'black-swan';
  if (percentile >= 95) return 'cyclical';
  if (percentile >= 85) return 'exceptional';
  if (percentile >= 70) return 'strong';
  return 'standard';
}
```

### 3. Rarity Bands

```typescript
type RarityBand = 'standard' | 'strong' | 'exceptional' | 'cyclical' | 'black-swan';

const RARITY_BAND_CONFIG: Record<RarityBand, {
  label: string;
  color: string;       // CSS color
  emoji: string;
  description: string;
  sizeMultiplier: number; // Position sizing hint
}> = {
  'standard': {
    label: 'Standard',
    color: '#22c55e',    // Green
    emoji: '🟢',
    description: 'Common opportunity — trade with base size',
    sizeMultiplier: 1.0,
  },
  'strong': {
    label: 'Strong',
    color: '#3b82f6',    // Blue
    emoji: '🔵',
    description: 'Above-average convergence — scale up 1.5×',
    sizeMultiplier: 1.5,
  },
  'exceptional': {
    label: 'Exceptional',
    color: '#8b5cf6',    // Purple
    emoji: '🟣',
    description: 'Rare alignment — scale up 2×',
    sizeMultiplier: 2.0,
  },
  'cyclical': {
    label: 'Cyclical',
    color: '#f59e0b',    // Amber/Gold
    emoji: '🟡',
    description: 'Multi-year event (halving, macro shift) — maximum conviction',
    sizeMultiplier: 2.5,
  },
  'black-swan': {
    label: 'Black Swan',
    color: '#ef4444',    // Red
    emoji: '🔴',
    description: 'Never seen before — protocol in uncharted territory. Verify data.',
    sizeMultiplier: 0,   // Don't auto-size — requires manual review
  },
};
```

### 4. Extend `GatedScore` Response

Add to the `GatedScore` type:
```typescript
interface GatedScore {
  // ... existing fields ...
  rarity?: {
    percentile: number;          // e.g., 97
    band: RarityBand;            // 'cyclical'
    label: string;               // "Cyclical"
    color: string;               // "#f59e0b"
    emoji: string;               // "🟡"
    description: string;         // Human-readable
    sizeMultiplier: number;      // Position sizing hint
    sampleSize: number;          // How many historical scores inform this
  };
}
```

### 5. API Endpoint

```
GET /api/scoring/gated/BTC-USD?protocol=btc-speed-v1&timeframe=5m&includeRarity=true
```

Response:
```json
{
  "symbol": "BTC-USD",
  "composite": 95,
  "signal": "BUY",
  "rarity": {
    "percentile": 97,
    "band": "cyclical",
    "label": "Cyclical",
    "color": "#f59e0b",
    "emoji": "🟡",
    "description": "Multi-year event (halving, macro shift) — maximum conviction",
    "sizeMultiplier": 2.5,
    "sampleSize": 312
  },
  ...
}
```

### 6. UI Representation

In the scoring dashboard or protocol card, show:

```
┌──────────────────────────────────────┐
│  BTC-SPEED-V1                        │
│                                      │
│  Score: 855/900 (95%)  🟡 Cyclical  │
│  ████████████████████████░░  97th %  │
│                                      │
│  This score is higher than 97% of    │
│  all scores in the past year. The    │
│  halving cycle bonus is active.      │
│                                      │
│  Recommended size: 2.5× base         │
└──────────────────────────────────────┘
```

A small inline gauge showing:
- Current score marker on a 0-100 bar
- Background color gradient matching the rarity band
- Percentile label below

### 7. Backfill

On deployment, run a backfill job that scores the past 365 days for each active protocol to build initial history. Without history, rarity defaults to 50th percentile (median) for the first 30 days.

## References
- Theory document: `docs/BTC-SPEED-PROTOCOL-THEORY.md` Section 2 ("The Rarity Gauge")
- Gating service: `nest/src/modules/scoring/protocol-gating.service.ts`
- Prisma schema: `nest/prisma/schema.prisma`
