# Crypto-Specific Directives

This document covers `crypto_fear_greed`, `btc_halving_cycle`, and `crypto_weekend_effect`.

## Crypto Fear and Greed Proxy

Recommended scope: `BTCUSD`, `ETHUSD`, `BTC`, `ETH`, and major crypto pairs.

The directive can consume an external prepared proxy score, or calculate a free-tier proxy from:

- BTC price momentum: 30%
- BTC volume change: 25%
- BTC volatility versus 30-day average: 25%
- BTC dominance change: 20%

Scoring is normalized around neutral 50:

- Proxy 0-25: +40
- Proxy 25-45: +20
- Proxy 45-55: 0
- Proxy 55-75: -15
- Proxy 75-100: -35

## Bitcoin Halving Cycle

Recommended scope: `BTCUSD`, `BTC`, and `BTCUSDT`.

The directive uses hardcoded Bitcoin halving dates. No API is required.

- 0-180 days post-halving: +15
- 180-365 days post-halving: +30
- 365-540 days post-halving: +20
- 540-720 days post-halving: -10
- 720+ days post-halving: -20

## Crypto Weekend Effect

Recommended scope: major crypto pairs.

Crypto trades 24/7, so the directive scores weekend-specific behaviour:

- Friday close in the top 30% of the weekly range: +15
- Sunday 18:00-22:00 UTC: +10
- Saturday: -5

## Strategy Template

The `Crypto Cycle` Strategy Builder template uses:

- Crypto Fear and Greed Proxy: 35%
- RSI: 25%
- Volume: 20%
- Bitcoin Halving Cycle: 20%

RSI strategy overrides should use oversold 20 and overbought 80 when per-strategy directive overrides are available.
