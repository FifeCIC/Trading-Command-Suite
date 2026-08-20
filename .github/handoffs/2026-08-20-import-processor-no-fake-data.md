---
date: 2026-08-20
area: data-import
type: fix
---

# Import processor no longer fabricates market data

## What Changed

- `nest/src/modules/import-jobs/import-jobs.processor.ts` — removed the
  `Math.random()` OHLCV fabrication and the unconditional
  `providerHealth = 'healthy'` upsert (both violated the no-demo-data policy).
  The worker now delegates to `ImportJobsService.importRealBars()` (provider
  chain: MT5 → Alpha Vantage → Trading212 → Yahoo), marks the import run
  `completed` only when real bars were stored, and `failed` with an error
  message otherwise. It never writes bars or health when no provider returned
  real data.
- `nest/src/modules/providers/adapters/trading212.adapter.ts` — corrected a
  misleading log line ("mock data only" → "disabled, fail-fast"). Behaviour
  was already correct: all methods return `null`/`[]` without credentials.

## What Was Verified

- MT5 bridge (`scripts/mt5-bridge/mt5_bridge_v2.py`) — clean: all endpoints
  serve real MT5 data or proper 503/404/empty responses. No fabrication.
- `mt5.adapter.ts`, `trading212.adapter.ts`, `importRealBars()` — clean:
  provider health is only stamped `healthy` after real bars were stored.
- Backend rebuilt and restarted; `/api/health` OK; automation loop scoring
  normally (18 decisions/tick, 13/13 protocols).

## Notes

- The BullMQ queue (`market-imports`) is still disabled by design —
  `enqueueImport()` executes imports directly. The processor is inert in
  local dev but is now safe to re-enable in production.
- IBKR adapter retains an opt-in mock stub gated by `IBKR_MODE=mock`
  (default `none`); left as-is per previous policy decision.
