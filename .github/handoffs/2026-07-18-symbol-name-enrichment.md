---
date: 2026-07-18
area: data
type: feature
---

## What Changed

Wired `SymbolNameEnricherService` into `DataImportOrchestrator` so the `profile` data type now actually calls provider `getProfile()` to enrich company names, replacing the old "no import needed" stub. Auto-registration paths in `import-jobs.service.ts` already had fire-and-forget enrichment; this closes the last gap.

## Files Changed

- `nest/src/modules/import-jobs/data-import-orchestrator.service.ts` — Injected `SymbolNameEnricherService`; added `profile` case to `ensureSymbolFresh()` switch that calls `enrichOne(ticker)`; added `skipProfile` option; updated doc comment

## Capability Map Entry

- **name:** Symbol Company Name Enrichment
- **persistence:** stored (updates Symbol.name in DB)
- **uiSurfaces:** 0 (Active Symbols page already shows name; fixes "No company name" display)
- **pipeline:** both (enrichment runs in orchestrator pipeline + auto-registration paths)
- **completion:** complete

## QA Test Entry

- **area:** Data / Symbols
- **name:** Profile enrichment resolves company names from providers
- **procedure:** `POST /api/symbols/enrich {"ticker":"MSFT"}` → verify response shows `name: "Microsoft Corp"`. Check `GET /api/symbols?search=MSFT` → `name` field shows company name, not ticker. For orchestrator path: trigger `/api/data/ensure-fresh` for a symbol with `name=ticker` → verify name updates.
- **expected:** Finnhub/FMP/Yahoo/Alpaca provide real company names; MT5 bridge provides instrument descriptions; Trading212 CFD codes (3XXX) expected to remain as-is since they aren't real tickers

## Architecture Framework Entry

- **section:** data
- **summary:** Symbol Name Enrichment — `SymbolNameEnricherService` already existed with `enrichOne()` / `enrichAll()` and `POST /api/symbols/enrich`. Now wired into `DataImportOrchestrator.ensureSymbolFresh()` so profile freshness checks actually trigger enrichment. Priority: Finnhub → FMP → Yahoo → Alpaca. Auto-registration in `import-jobs.service.ts` already fire-and-forgets enrichment on symbol creation. Files: symbol-name-enricher.service.ts, data-import-orchestrator.service.ts, import-jobs.service.ts.
