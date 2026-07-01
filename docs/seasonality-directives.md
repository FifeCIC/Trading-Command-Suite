# seasonality-directives: Calendar-Based Scoring Directives

**Prompt ID:** seasonality-directives
**Date:** 2026-06-24
**Status:** ready

## Goal

Create a family of calendar-based scoring directives that encode well-documented seasonal effects in financial markets. These directives provide mild signal boosts (+-5 to 15 points) based on statistically significant historical patterns.

## Directives to Create

| Directive ID | Pattern | maxScore | Signal |
|-------------|---------|----------|--------|
| `santa-claus-rally` | Dec 24–Jan 2 bullish | 20 | BUY Dec 24–Jan 2, NEUTRAL otherwise |
| `january-effect` | Jan small-cap outperformance | 15 | BUY in Jan for small-cap indices |
| `sell-in-may` | May–Oct seasonal weakness | 15 | SELL bias May–Oct on equities |
| `september-slump` | September = worst month since 1950 | 20 | SELL bias all September |
| `october-relief` | October reversal from Sept selloff | 15 | BUY bias mid-to-late October |
| `monday-effect` | Mondays statistically red | 10 | SELL bias on Mondays |
| `friday-drift` | Fridays close higher 58% | 10 | BUY bias on Fridays |
| `turnaround-tuesday` | Tuesday reverses Monday | 15 | OPPOSITE of Monday's direction |
| `opex-gamma` | 3rd Friday monthly — pinning | 10 | NEUTRAL (suppresses directional bets) |
| `triple-witching` | Mar/Jun/Sep/Dec 3rd Fri volume | 5 | NEUTRAL (volatility warning) |
| `election-cycle` | Year 3 of presidential cycle | 10 | BUY in pre-election year |

## Implementation Pattern

Each directive follows the standard interface:
```typescript
@Injectable()
export class SantaClausRallyDirective implements ScoringDirective {
  readonly id = 'santa-claus-rally';
  readonly maxScore = 20;

  async evaluate(input: DirectiveInput): Promise<DirectiveResult> {
    const now = new Date();
    const month = now.getMonth(); // 0=Jan, 11=Dec
    const day = now.getDate();

    // Dec 24 to Jan 2 = bullish window
    const isWindow = (month === 11 && day >= 24) || (month === 0 && day <= 2);

    return {
      directiveId: this.id,
      score: isWindow ? 15 : 5,
      maxScore: this.maxScore,
      signalClass: isWindow ? 'bullish' : 'neutral',
      reason: isWindow ? 'Santa Claus rally window (Dec 24–Jan 2)' : 'Outside Santa Claus rally window',
    };
  }
}
```

## Integration

- Register in NestJS DirectivesModule
- Add to DIRECTIVE_GROUPS or protocol-specific groups
- Score contributes +-5 to 15 points (mild tilt, not trade-thesis)
- Tag in suitability registry: `regime: 'any'`, `volatility: 'any'`, `timeframe: '1d'`

## Files

- `nest/src/modules/directives/implementations/santa-claus-rally.directive.ts`
- `nest/src/modules/directives/implementations/january-effect.directive.ts`
- `nest/src/modules/directives/implementations/sell-in-may.directive.ts`
- `nest/src/modules/directives/implementations/september-slump.directive.ts`
- `nest/src/modules/directives/implementations/october-relief.directive.ts`
- `nest/src/modules/directives/implementations/monday-effect.directive.ts`
- `nest/src/modules/directives/implementations/friday-drift.directive.ts`
- `nest/src/modules/directives/implementations/turnaround-tuesday.directive.ts`
- `nest/src/modules/directives/implementations/opex-gamma.directive.ts`
- `nest/src/modules/directives/implementations/triple-witching.directive.ts`
- `nest/src/modules/directives/implementations/election-cycle.directive.ts`
