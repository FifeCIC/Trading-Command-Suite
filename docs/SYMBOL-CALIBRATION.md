# GitHub Issue: Symbol-Specific Directive Calibration

## Concept
Instead of 500 symbol-exclusive directives, use a calibration layer that adjusts directive weights per symbol based on what we know about that symbol's behavior.

## Calibration Data Per Symbol
```typescript
interface SymbolCalibration {
  symbol: string;
  overrides: {
    [directiveId: string]: {
      weightMultiplier: number;   // 0.5 = half weight, 3.0 = triple
      reason: string;             // "DOGE is 3x more sensitive to social sentiment"
      decayModifier?: number;     // How fast news effects decay for this symbol
      volatilityAdjustment?: number; // How to adjust for this symbol's natural volatility
    }
  }
}
```

## Example Calibrations

### DOGEUSD
- `news-sentiment`: 3.0x (social media drives DOGE)
- `volume-surge`: 1.5x (whale activity precedes moves)
- `panic-exhaustion`: 2.0x (DOGE capitulations are sharper)
- `session-timing-filter`: 1.0x (24/7 crypto — sessions matter less)

### XAUUSD
- `news-sentiment`: 1.5x (geopolitical news heavily affects gold)
- `dollar-index`: N/A new directive — DXY inverse correlation
- `rsi-oversold`: 0.7x (gold trends strongly — mean-reversion less reliable)
- `vix-regime`: 0.5x (gold has its own fear dynamic)

### NVDA
- `earnings-proximity`: 2.5x (NVDA earnings are massive events)
- `momentum-roc`: 1.3x (NVDA trends persist longer)
- `volume-confirmation`: 1.2x (NVDA volume is informative)
- `news-sentiment`: 1.8x (AI news cycle directly affects NVDA)

### BTCUSD
- `session-timing-filter`: 0.6x (crypto doesn't follow traditional sessions)
- `volume-surge`: 1.4x (BTC volume precedes moves)
- `hurst-memory`: 0.8x (BTC trends differently than forex)
- `market-entropy`: 1.2x (BTC regime shifts matter more)

## Implementation
- Calibration data stored in database (Prisma model)
- Calibration service loads per-symbol overrides
- Scoring pipeline applies calibration multipliers before weighted aggregation
- Admin UI for editing calibrations
- Default calibration = 1.0x for all directives (no effect)

## Relationship to Strategy
When user adds a symbol to a strategy, prompt: "NVDA has 4 symbol-specific directive calibrations. Apply them?" User can accept, reject, or customize.

Labels: directives, calibration, data, P0
