---
date: 2026-08-16
area: data
type: bugfix
---

## What Changed

Fixed `PortfolioService.getPortfolio()` to honor its `source` parameter — previously it ignored `source` and always returned Trading212 only, so `/api/portfolio?source=all` silently excluded MT5 positions. It now resolves adapters via `AdapterFactory` (`source=all` → trading212 + mt5), fetches positions + accounts in parallel, tags each position with a `broker` field, sums cash across accounts, and reports provider `"Trading212 + MT5"` for `all`.

## Files Changed

- nest/src/modules/portfolio/portfolio.service.ts — source-aware aggregation: `AdapterFactory`-driven multi-broker fetch, per-position `broker` tag, summed cash, joined provider string, new `accounts` array in the response

## Capability Map Entry

- **name:** Multi-broker portfolio aggregation (Trading212 + MT5)
- **persistence:** ephemeral
- **uiSurfaces:** 1 (Accounts Dashboard / portfolio summary)
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Portfolio / Data
- **name:** `source=all` includes MT5 positions
- **procedure:** `GET /api/portfolio?source=all`, then compare with `source=trading212` and `source=mt5`
- **expected:** `all` returns 13 positions (9 Trading212 + 4 MT5) with provider `"Trading212 + MT5"` and combined P&L; `mt5` returns 4 positions; `trading212` returns 9.

## Architecture Framework Entry

- **section:** data
- **summary:** Portfolio aggregation is now broker-aware — `PortfolioService.getPortfolio(source)` resolves `trading212 | mt5 | all` via `AdapterFactory`, merging normalized `BrokerPosition[]` with a per-position `broker` tag and summing cash across accounts. Key file: `nest/src/modules/portfolio/portfolio.service.ts`.
