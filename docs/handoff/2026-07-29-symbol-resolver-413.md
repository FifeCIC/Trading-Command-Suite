# Handoff: Shared Symbol Tier Resolver (#413)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-29
**Issue:** #413 — Architecture - Shared Symbol Tier Resolver

## What was built

A single `SymbolResolverService` in the `symbols/` module that consolidates all symbol resolution logic previously scattered across 4 services. Every subsystem now resolves "which symbols to act on" through the same service.

### SymbolResolverService (`nest/src/modules/symbols/symbol-resolver.service.ts`)

**8 tier resolvers:**
| Tier | Source | Use |
|------|--------|-----|
| `positions` | DB `position` table (distinct symbols) | Always included |
| `active-strategies` | DB `tradingStrategy` where active=true | Strategy symbols |
| `active-protocols` | `symbolProtocolAssignment` + watchlists | Protocol coverage |
| `watchlist-starred` | Watchlists linked to active scoring strategies | Scoring watchlists |
| `macro` | Static list (SPY, QQQ, VIX, etc.) | Market context |
| `sector` | Static list (XLK, XLF, etc.) | Sector coverage |
| `forex-floor` | Static list (EURUSD, GBPUSD, XAUUSD, etc.) | Directive ops minimum |
| `all-active` | DB `symbol` where active=true | Full universe |

**4 feature presets:**
| Feature | Tiers |
|---------|-------|
| `news` | positions + active-protocols + macro + sector + all-active |
| `bar-refresh` | positions + active-strategies + forex-floor |
| `scoring` | active-strategies |
| `automation` | positions + active-strategies + watchlist-starred |

All methods accept optional `limit` (default 200).

### Services wired

- **NewsImportService**: `resolveTierSymbols()` and `resolveTrackedSymbols()` delegate to resolver. Removed duplicate MACRO_SYMBOLS/SECTOR_SYMBOLS constants (now imported from resolver).
- **BarRefreshService**: `resolveRefreshSymbols()` delegates to `getSymbolsForFeature('bar-refresh')`. Removed inline DB queries for positions/strategies.
- **AutomationLoopService**: Strategy symbol collection uses `getSymbolsByTier('active-strategies')`.

### Debug endpoint

`GET /api/symbols/resolution?tier=<tier>&feature=<feature>&limit=<n>`

Without params: returns all symbols across all tiers.

### Module changes

- `SymbolsModule` now exports `SymbolResolverService`
- `NewsModule`, `MarketDataModule`, `AutomationModule` import `SymbolsModule`

### Files changed

| File | Change |
|------|--------|
| `nest/src/modules/symbols/symbol-resolver.service.ts` | NEW — shared resolver |
| `nest/src/modules/symbols/symbols.module.ts` | Register + export resolver |
| `nest/src/modules/symbols/symbols.controller.ts` | Add GET /resolution endpoint |
| `nest/src/modules/news/news-import.service.ts` | Delegate to resolver; remove local constants |
| `nest/src/modules/news/news.module.ts` | Import SymbolsModule |
| `nest/src/modules/market-data/bar-refresh.service.ts` | Delegate to resolver |
| `nest/src/modules/market-data/market-data.module.ts` | Import SymbolsModule |
| `nest/src/modules/automation/automation-loop.service.ts` | Delegate strategy symbols to resolver |
| `nest/src/modules/automation/automation.module.ts` | Import SymbolsModule |
