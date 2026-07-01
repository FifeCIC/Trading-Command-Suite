# Analyst Forecast Sources Guide

**Type:** Implementation Reference  
**Last Updated:** 2026-07-01

## Overview

Multi-source analyst price target data with merge, deviation scoring, and directive integration. Provides consensus analyst targets for equity symbols.

## Architecture

```
PriceForecastPage.jsx
  → fetchAnalystTargets() (src/core/api/research.js)
    → GET /api/research/analyst/targets?symbols=X,Y,Z
      → ResearchController
        → FinnhubAdapter.getPriceTarget()
        → FMP adapter (price-target endpoint)
```

## Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/research/analyst/targets?symbols=AAPL,MSFT` | Multi-symbol analyst targets |
| `GET /api/research/analyst/targets/:symbol` | Single symbol detail |

## Data Sources

### Finnhub — `/stock/price-target`
Returns: `targetHigh`, `targetLow`, `targetMean`, `targetMedian`, `numberOfAnalysts`, `lastUpdated`
Free tier: 60 calls/min. Key from finnhub.io/register.

### FMP — `/price-target`
Returns: `targetHigh`, `targetLow`, `targetConsensus`, `targetMedian`, `numberOfAnalysts`

## Related Directives

- **AnalystAdjustmentsDirective** (`nest/src/modules/directives/implementations/analyst-adjustments.directive.ts`) — scores price target data against current price

## Files

| File | Purpose |
|------|---------|
| `src/pages/PriceForecastPage.jsx` | Dashboard UI with sortable forecast table |
| `src/core/api/research.js` | API client for analyst targets |
| `nest/src/modules/providers/adapters/finnhub.adapter.ts` | Finnhub price target endpoint |
| `nest/src/modules/directives/implementations/analyst-adjustments.directive.ts` | Directive scoring |
