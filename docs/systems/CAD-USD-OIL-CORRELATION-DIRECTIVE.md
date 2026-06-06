# CAD/USD Oil Correlation Directive

`cad_usd_oil_correlation` scores the CAD petrocurrency relationship against WTI crude oil and CAD/USD movement.

## Data Source Decision

The directive consumes prepared scoring data instead of calling provider APIs directly:

- WTI crude oil history should come from Alpha Vantage `WTI`.
- CAD/USD or USD/CAD daily FX history should come from Alpha Vantage `FX_DAILY`.
- Fed Funds can come from Alpha Vantage `FEDERAL_FUNDS_RATE`.
- Bank of Canada policy rate is optional until a stable source is configured.

Provider calls, caching, and freshness checks stay in the data layer. The directive receives the resulting series through the scoring run.

## Scoring

- WTI rising more than 3% over five sessions while CAD has moved less than half as much: `score_delta` +35.
- WTI falling more than 3% over five sessions while CAD has moved less than half as much: `score_delta` -25.
- WTI and CAD moving in sync: `score_delta` 0.
- WTI at the supplied series high: +15.
- WTI at the supplied series low: -15.
- Bank of Canada rate above Fed Funds: +10.
- Fed Funds above Bank of Canada rate: -10.

The public `score` is normalized around a neutral 50 so it remains compatible with the existing nonnegative directive contract.
