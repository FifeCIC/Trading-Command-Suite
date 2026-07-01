# protocol-calendar: Seasonal Protocol Prioritization Engine

**Prompt ID:** protocol-calendar  
**Date:** 2026-06-24  
**Status:** ready

## Goal

Build a calendar-driven protocol prioritization system that automatically weights protocols based on their historical seasonal performance. SEES uses this to intelligently prioritize which protocols and strategies to run based on the current date.

## Concept

Each protocol gets a `seasonalAffinity` map that defines how it performs in different months:

```typescript
interface SeasonalAffinity {
  // Month number (0=Jan, 11=Dec) → weight multiplier (-1.0 to +1.0)
  monthly: Record<number, number>;
  // Special date ranges
  dateRanges?: Array<{
    start: { month: number; day: number };
    end: { month: number; day: number };
    weight: number;
    label: string;
  }>;
}
```

Example for spy-day-v1:
```typescript
{
  monthly: {
    0: 0.10,  // Jan: +10% (January effect, earnings)
    1: 0.05,  // Feb: +5%
    2: 0.00,  // Mar: neutral
    3: 0.10,  // Apr: +10% (earnings kickoff)
    4: -0.05, // May: -5% (sell in May)
    5: -0.10, // Jun: -10% (summer doldrums)
    6: -0.10, // Jul: -10% (summer doldrums)
    7: -0.05, // Aug: -5%
    8: -0.15, // Sep: -15% (worst month)
    9: 0.05,  // Oct: +5% (earnings, reversal)
    10: 0.10, // Nov: +10% (holiday rally)
    11: 0.15, // Dec: +15% (Santa Claus rally)
  },
  dateRanges: [
    { start: { month: 11, day: 24 }, end: { month: 0, day: 2 }, weight: 0.20, label: 'Santa Claus Rally' },
    { start: { month: 2, day: 15 }, end: { month: 2, day: 21 }, weight: -0.10, label: 'Triple Witching' },
  ]
}
```

## How It Works

1. When SEES scores protocols, it checks the current date
2. Each protocol's monthly affinity weight is applied as a multiplier to its composite score
3. Special date ranges override monthly weights
4. SEES ranks protocols by their seasonally-adjusted score
5. The Speed Trading auto-switch naturally gravitates toward seasonally-favored protocols

## Integration Points

- Add `seasonalAffinity` field to PROTOCOL_REGISTRY entries
- SEES Live Stack applies seasonal weighting when ranking
- Speed Trading auto-switch uses seasonally-weighted rankings
- Protocol detail panel shows current seasonal affinity

## Files

- `nest/src/modules/scoring/seasonal-affinity.service.ts` — computes current affinity weights
- Updates to `PROTOCOL_REGISTRY` in `directive-groups.ts` — add seasonalAffinity to each protocol
- Integration in `scoring.service.ts` and `speed-scan.service.ts`
