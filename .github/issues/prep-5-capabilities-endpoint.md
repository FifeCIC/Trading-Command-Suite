## Problem

Layer B (Capability Contracts, #517) needs to check what timeframes and bar depths are available before activating a strategy. Right now the `/api/market-data/bars/refresh/status` endpoint returns some of this but in an internal format. We need a clean public contract.

## Task

Add a `GET /api/market-data/capabilities` endpoint that returns a machine-readable declaration of what the data pipeline provides.

## Contract

```json
{
  "availableTimeframes": ["5m", "15m", "1h", "4h", "1d"],
  "barDepth": {
    "5m": 200,
    "15m": 200,
    "1h": 200,
    "4h": 200,
    "1d": 200
  },
  "refreshIntervalMs": 300000,
  "mode": "live",
  "lastRefresh": "2026-07-29T...",
  "providerStatus": {
    "mt5": "connected",
    "yahoo": "degraded"
  },
  "activeSymbolCount": 23
}
```

## Steps

- [ ] Add `@Get('capabilities')` to `MarketDataController`
- [ ] Method reads from `BarRefreshService` (timeframes, limits, status) and `ProviderHealthService` (provider status)
- [ ] Response shape is the contract above — flat, machine-readable
- [ ] Add OpenAPI decorators for documentation
- [ ] Build passes

## Acceptance

- [ ] `GET /api/market-data/capabilities` returns 200
- [ ] Response matches the contract shape above
- [ ] Timeframes reflect what BarRefreshService actually fetches
- [ ] Provider status reflects current health
- [ ] Endpoint is fast (no external calls — reads cached state)

## Related

- #517 (Layer B: Capability Contracts)
