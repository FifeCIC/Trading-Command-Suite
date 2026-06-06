# Symbol-Specific Equity Directives

This document covers `tsla_sentiment_amplifier` and `nvda_earnings_momentum`.

## TSLA Sentiment Amplifier

Recommended scope: `TSLA`.

Scoring:

- RSI below 35 and volume above 1.5x average volume: `score_delta` +35.
- RSI above 75 and volume above 2x average volume: `score_delta` -30.
- Price within 5% of 52-week low: +25.
- Price within 5% of 52-week high: -20.
- Short interest above 3% of float: +10.

The strategy template `TSLA Swing` uses TSLA Sentiment Amplifier 40%, RSI 25%, Volume 20%, and MACD 15%. RSI strategy overrides should use oversold 25 and overbought 75 when per-strategy directive overrides are available.

## NVDA Earnings Momentum

Recommended scope: `NVDA`.

Data source decision:

- Earnings calendar should come from Alpha Vantage `EARNINGS_CALENDAR`.
- Historical beat/miss context should come from Alpha Vantage `EARNINGS`.
- 50-day moving average and ADX come from the existing technical scoring data path.

Scoring:

- 14-30 days before earnings: +20.
- 7-14 days before earnings: +15.
- 0-7 days before earnings: -10.
- 1-5 days after earnings beat with price up more than 5%: +25.
- 1-5 days after earnings miss with price down more than 5%: -20.
- Price above 50-day MA and ADX above 25: +20.

The strategy template `NVDA Earnings Play` uses NVDA Earnings Momentum 45%, ADX 25%, Moving Averages 20%, and Volume 10%.
