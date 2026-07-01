# xau-speed-v1: Gold Speed Scalp Protocol

**Prompt ID:** xau-speed-v1
**Date:** 2026-06-23
**Status:** ready

## Goal

Create a sub-minute speed scalping protocol for XAUUSD (Gold). This is separate from `gold-macro-v1` which is a position/trend-following protocol. This protocol targets $1–$5 trades held seconds to minutes.

## Why Gold for Speed Trading

- Second-most traded instrument after EURUSD
- Extremely volatile during news (CPI, FOMC, NFP, geopolitics)
- Tight spreads on XTrend (~20–30 cents on XAUUSD)
- Reacts violently to USD strength, real rates, inflation data
- Gold is the ultimate "fear gauge" — moves on every headline

## Directive Groups

### Technical (40%, non-gating)
- `speed-momentum` (120) — 5-candle ROC for gold micro-moves
- `bollinger-squeeze` (100) — Gold squeeze before data releases
- `volume-confirmation` (100) — Volume spike confirms move
- `atr-expansion` (100) — Micro-ATR for gold tick sizing
- `rsi-oversold` (120) — Oversold bounce on gold
- `rsi-overbought` (100) — Overbought reversion
- `support-resistance` (100) — Gold respects round numbers ($2000, $2050, $2100)
- `session-timing-filter` (100) — Only trade liquid gold sessions

### Sentiment (20%, non-gating)
- `news-sentiment` (100) — Gold IS a sentiment instrument
- `gold-macro-correlation` (100) — DXY, real rates context (even for speed!)

### Risk (40%, GATE: 0.4–1.3)
- `volatility-regime` (100) — Extreme vol kills scalps
- `liquidity-check` (100) — Gold spreads can widen during news
- `position-concentration` (100) — Don't over-allocate gold scalps
- `crypto-weekend-effect` (50) — Weekend gap risk (gold trades 24/5 but thin weekends)

## Recommendation

- **Timeframe:** 5s–30s candles
- **Sessions:** London/NY overlap (12:00–16:00 GMT) — gold is most liquid then
- **Avoid:** First 5 minutes after major news (spreads widen dramatically)

## Implementation

File: `nest/src/modules/directives/directive-groups.ts`
Register as `xau-speed-v1` in PROTOCOL_REGISTRY.
