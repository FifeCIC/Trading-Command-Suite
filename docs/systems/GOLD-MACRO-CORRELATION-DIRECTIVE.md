# Gold Macro Correlation Directive

`gold_macro_correlation` scores gold against the macro factors that most often drive XAU/USD and gold ETF positioning.

## Data Source Decision

The directive consumes prepared scoring data instead of calling provider APIs during scoring:

- Treasury 10-year yield should come from Alpha Vantage `TREASURY_YIELD` with `maturity=10year`.
- CPI inflation should come from Alpha Vantage `INFLATION`.
- USD strength history should come from a cached USD index, DXY proxy, or Alpha Vantage currency feed.
- Fed Funds history should come from Alpha Vantage `FEDERAL_FUNDS_RATE`.
- VIX is optional and can come from the existing market-regime data layer.

Provider calls, caching, and freshness checks stay in importers. The directive receives those series through the scoring run.

## Scoring

Real yield proxy is calculated as:

```text
Treasury 10-year yield - CPI inflation rate
```

- Real yield falling from the prior observation: `score_delta` +30.
- Real yield rising from the prior observation: `score_delta` -20.
- Real yield below zero: +20.
- USD strength falling over 10 sessions: +20.
- USD strength rising over 10 sessions: -15.
- Fed Funds cut in the last 90 days: +15.
- Fed Funds hike in the last 90 days: -10.
- VIX above 25: +10.

The public `score` is normalized around a neutral 50 and capped at 125 to remain compatible with the existing nonnegative directive contract.

## Strategy Template

The `Gold Macro` Strategy Builder template uses:

- Gold Macro Correlation: 45%
- Moving Averages: 25%
- RSI: 20%
- Volume: 10%

Recommended scope is `XAUUSD`, `GLD`, and `IAU`. RSI configuration should use oversold 35 and overbought 65 when strategy-specific directive overrides are available.
