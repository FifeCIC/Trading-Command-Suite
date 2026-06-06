# VIX Regime Directive

`vix_regime` scores the broad US equity and ETF regime from volatility fear/complacency.

## Data Source Decision

The directive does not call provider APIs directly. It consumes market-regime data already supplied to the scoring run:

- Preferred: direct VIX or `^VIX` data from a premium provider such as Finnhub or FMP.
- Fallback: annualized SPY realized volatility from stored SPY daily bars when direct VIX is unavailable.
- Unavailable: if neither source is supplied, the directive returns a neutral score with `signal_type` set to `unavailable`.

This keeps provider selection and caching outside directive math while allowing free-tier operation through a documented proxy.

## Scoring

- VIX > 30: `score_delta` +40
- VIX 20-30: `score_delta` +20
- VIX 15-20: `score_delta` 0
- VIX 12-15: `score_delta` -15
- VIX < 12: `score_delta` -30
- VIX rise >40% over five sessions: additional +20 spike bonus

The public `score` is normalized around a neutral 50 so it remains compatible with the existing nonnegative directive contract.
