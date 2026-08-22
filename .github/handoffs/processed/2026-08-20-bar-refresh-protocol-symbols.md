---
date: 2026-08-20
area: automation
type: fix
---

## What Changed

Bar refresh now covers protocol symbols and falls back across brokers (#665).
Before: the live bar refresh only fetched `positions + active-strategies +
forex-floor`, so protocol-resolved symbols were never fed — SPY/QQQ/VIX had
0 bars and USDJPY/AUDUSD/NZDUSD were stale (up to a week old). Broker-side
gaps (MetaQuotes demo stopped feeding AUDUSD 08-17 and NZDUSD 08-13) had no
recovery path.

## Files Changed

- nest/src/modules/symbols/symbol-resolver.service.ts — new `protocol-symbols`
  tier: mirrors ProtocolDbService.resolveSymbols paths (assignments →
  watchlist.protocolId → derivation hints) without a scoring-module
  dependency. Added to the `bar-refresh` feature map.
- nest/src/modules/scoring/protocol-db.service.ts — extracted the
  single-symbol/named-watchlist derivation rules into shared exports
  (`SINGLE_SYMBOL_HINTS`, `WATCHLIST_HINTS`, `deriveSingleSymbolFromSlug`);
  `deriveSymbolsFromId` now consumes them (single source of truth).
- nest/src/modules/market-data/bar-refresh.service.ts — multi-broker
  fallback: when the primary bridge returns no candles or only stale ones
  (per-timeframe thresholds), fetch from the other configured MT5 bridges
  and keep the freshest set.

## Capability Map Entry

- **name:** Protocol-symbol bar coverage + multi-broker fallback
- **persistence:** marketbar (existing)
- **uiSurfaces:** 0

## QA

- After restart: SPY 200×5m bars (fresh), QQQ 200 (fresh), VIX 100 (fresh —
  only exists on the Pepperstone bridge, proving fallback), AUDUSD fresh
  (was 08-17), NZDUSD fresh (was 08-13), USDJPY fresh (was 08-18).
- Protocol statuses flipped from no-data to scoring on the next tick:
  spy-speed-v1, spy-day-v1, qqq-speed-v1, qqq-day-v1, vix-spike-v1 all
  `scoring [1/1]`.
- Every active protocol now scores (12/12).

## Architecture Entries

- SymbolResolver tier: `protocol-symbols` (bar-refresh feature).
- BarRefreshService: multi-broker fallback via Mt5ConnectionManager.
