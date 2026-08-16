---
date: 2026-08-16
area: providers
type: refactor
---

## What Changed

Removed all fabricated fallback data from provider adapters and research data paths. Previously, when no API key was configured (or a live call returned no data), the Trading212 and Alpha Vantage adapters returned hardcoded/mock quotes, candles, profiles, and prices (e.g. NVDA 485.25, AAPL 198.32, default 100). Now they return `null` (quote/profile) or `[]` (candles) so the UI shows "—" honestly instead of a wrong price.

Also removed mock portfolio/scores from the export controller and synthetic demo news articles from the news collector.

Second pass: removed fabricated demo data from the Lab timeline (hardcoded FOMC/NVIDIA/CPI "events", random session "predictions", and hardcoded priority-symbol scores — now session opens only), disabled the Interactive Brokers mock stub by default (`IBKR_MODE` defaults to `none`), and removed `Math.random()`/hardcoded scores from the prototype predictive-scoring and strategy-competition services.

## Files Changed

- nest/src/modules/providers/adapters/trading212.adapter.ts — getQuote/getCandles/getProfile return null/[] when no credentials; deleted fallbackQuote/fallbackCandles/fallbackProfile/fallbackPrice
- nest/src/modules/providers/adapters/alpha-vantage.adapter.ts — getQuote/getCandles/getProfile return null/[] (no mock fallback); getCapabilities() returns [] when no key; deleted getMockQuote/getMockCandles/getMockProfile/getBasePriceForSymbol
- nest/src/modules/export/export.controller.ts — portfolio CSV + scores JSON no longer contain mock rows; strategy share card marked STUB with neutral values
- nest/src/modules/news/news-collector.service.ts — removed SEED_ARTICLES (15 synthetic demo headlines); collector starts empty
- nest/src/modules/timeline/timeline.service.ts — removed SEED_EVENTS + PRIORITY_SYMBOLS + randomSessionBias + getBaseScore (fake events/predictions/scores); session opens remain
- nest/src/modules/providers/adapters/interactive-brokers.adapter.ts — IBKR_MODE now defaults to 'none' (mock stub no longer fabricates by default)
- nest/src/modules/scoring/predictive-scoring.service.ts — getCurrentScore() returns 0 (no fabricated base scores)
- nest/src/modules/scoring/strategy-competition.service.ts — removed dead generateSignalsFromDirectives() mock; getStatus() totalDirectives no longer hardcoded to 75

## Result

No provider ever fabricates a price/candle/profile. Offline/unknown symbols show "no data" instead of a hardcoded value. Research Overview portfolio prices, symbol quotes, and News Intel no longer surface fake numbers.

## Capability Map Entry

- **name:** Provider mock-data removal
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** providers
- **completion:** complete

## QA Test Entry

- **area:** Providers
- **name:** No fabricated fallback prices
- **procedure:** With provider API keys unset, request a quote/candles/profile for NVDA via the relevant endpoint; confirm no hardcoded 485.25 appears.
- **expected:** null/empty response; UI shows "—"/"unavailable".

## Architecture Framework Entry

- **section:** providers
- **summary:** Provider adapters no longer fabricate market data when offline (removed mock fallbacks in trading212 + alpha-vantage adapters; IBKR mock stub now opt-in via IBKR_MODE=mock). Export controller and news collector mock data removed. Lab timeline demo events/predictions/scores removed (session opens only). Prototype predictive-scoring + strategy-competition no longer fabricate scores. Honest "no data" replaces fake values.
