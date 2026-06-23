# oil-speed-v1: Oil Speed Scalp Protocol

**Prompt ID:** oil-speed-v1
**Date:** 2026-06-23
**Status:** ready

## Goal

Create a sub-minute speed scalping protocol for USOIL (WTI Crude). This is separate from `oil-supply-v1` which is a trend/event-driven position protocol. This protocol targets $1–$5 trades held seconds to minutes around supply events and session volatility.

## Why Oil for Speed Trading

- Extremely event-driven: EIA weekly inventories, OPEC headlines, geopolitical supply shocks
- Volatile intraday — crude can move 1–2% in minutes on news
- Tight spreads on XTrend for USOIL (~3–5 cents)
- Reacts to USD, equity sentiment, Middle East headlines
- Strong mean-reverting tendencies within daily ranges

## Directive Groups

### Technical (40%, non-gating)
- `speed-momentum` (120) — 5-candle ROC for oil micro-moves
- `bollinger-squeeze` (100) — Oil squeezes before EIA/OPEC events
- `volume-confirmation` (100) — Volume spike confirms crude move
- `atr-expansion` (100) — Micro-ATR for oil tick sizing
- `rsi-oversold` (120) — Oversold oil bounce (mean reversion)
- `rsi-overbought` (100) — Overbought oil reversion
- `support-resistance` (100) — Oil respects key levels ($70, $75, $80, $85)
- `session-timing-filter` (100) — Only trade during NY/liquid sessions

### Sentiment (25%, non-gating)
- `news-sentiment` (100) — OPEC, EIA, geopolitics dominate oil
- `cad-usd-oil-correlation` (100) — Oil/CAD correlation as confirmation

### Risk (35%, GATE: 0.45–1.3)
- `volatility-regime` (100) — Oil vol spikes on geopolitics
- `liquidity-check` (100) — Crude spreads matter for $1 scalps
- `position-concentration` (100) — Don't over-allocate energy
- `session-open-effect` (100) — NY open crude moves

## Recommendation

- **Timeframe:** 5s–30s candles
- **Sessions:** NY session (13:30–20:00 GMT) — crude is NY-driven
- **Events:** EIA report Wednesdays 14:30 GMT — massive volatility
- **Avoid:** Asian session — oil is thin and whippy

## Implementation

File: `nest/src/modules/directives/directive-groups.ts`
Register as `oil-speed-v1` in PROTOCOL_REGISTRY.
