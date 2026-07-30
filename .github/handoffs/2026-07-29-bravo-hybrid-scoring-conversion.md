# Handoff — BRAVO Directive Hybrid Scoring Conversion (2026-07-29)

## What Changed
Converted ALL 35 BRAVO directives to hybrid base+bonus v2.0.0 scoring, completing Layer C (#518 started with 10, now all 35 done).

### 6 Real BRAVO Directives (full rewrite)
Each had existing custom scoring logic — restructured to continuous base + threshold bonus pattern:

| Directive | Base (mapRange) | Bonus Tiers | maxScore |
|-----------|----------------|-------------|----------|
| `dxy-regime` | DXY 108→0pts, DXY 95→100pts | Extreme >108 or <95 → +25 | 125 |
| `gold-macro-correlation` | DXY 108→0, 95→100 (gold only) | Yield extreme → +20, VIX>25 → +15 | 135 |
| `cad-usd-oil-correlation` | DXY 108→0, 95→100 (flipped for USDCAD) | WTI>$85 → +25 | 125 |
| `earnings-proximity` | |days| 0→55pts, 14→40pts | Within 1d → +25, 3d → +10 | 80 |
| `analyst-adjustments` | bullishPct 40→0pts, 95→80pts | strongBuyPct>35% → +15, trend>5% → +10 | 105 |
| `news-sentiment-positive` | avgSent -0.5→15, 0.5→85 | >0.5 → +15, <-0.5 → reversal (0) | 100 |

### 29 BRAVO Stubs (placeholder-directives.stub.ts)
Upgraded from `score: 0, confidence: 0` to real hybrid scoring using available indicators:

- **Technical (5)**: moving-averages (SMA), volatility-tools (ATR), macd (MACD histogram), mean-reversion (BB), resistance-levels-strategy (pivots)
- **Price Action (3)**: pin-bar-pattern (wick/body), time-based-support (VWAP), intraday-u-pattern (recovery)
- **Calendar/Rhythm (6)**: friday-positioning, midweek-momentum, advanced-weekly-rhythm, basic-weekly-rhythm, weekly-rhythm-strategy, institutional-timing
- **Sentiment/Social (7)**: spy-options-expiry, spy-month-end-rebalancing, spy-qqq-relative-strength, nvda-earnings-momentum, tsla-sentiment-amplifier, dividend-yield-attractive, isa-reset
- **Strategy (8)**: portfolio-performance, adaptive-risk-monitor, conviction-growth, earnings-implementation, earnings-whispers, like-zacks, sp500-regime, vix-strategy

All return `metadata: { baseScore, bonusScore, bonusLabel }` and use `mapRange()` utility (added at module level in stub file).

## Files Changed
- `nest/src/modules/directives/implementations/dxy-regime.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/gold-macro-correlation.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/cad-usd-oil-correlation.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/earnings-proximity.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/analyst-adjustments.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/news-sentiment.directive.ts` — v1.0.0→v2.0.0, hybrid scoring
- `nest/src/modules/directives/implementations/placeholder-directives.stub.ts` — 29 stubs upgraded, mapRange added

## Verification
- NestJS build: **zero errors**
- Vite build: **zero errors**
- Velocity endpoint: working (adaptive-risk-monitor, sp500-regime, weekly-rhythm-strategy all contributing drift)
- API directives listing: 104 total, 68 READY / 35 BRAVO / 1 ALPHA

## Related Issues
- #518 (Layer C — now fully complete with all 35 BRAVO converted)
- #519 (Score Momentum — completed earlier in this session)
