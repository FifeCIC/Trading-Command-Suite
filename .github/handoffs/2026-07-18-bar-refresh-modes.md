---
date: 2026-07-18
area: data
type: feature
---

## What Changed

Split BarRefreshService into live (10 bars/5min for active trading symbols) vs record (100 bars/on-demand for all watchlist symbols) modes. Replaced hardcoded `ALWAYS_SYMBOLS` with tier-based symbol resolution (positions + active strategies + floor forex pairs). Added env-configurable limits, start/stop API, and status endpoint.

## Files Changed

- `nest/src/modules/market-data/bar-refresh.service.ts` — Split into `refresh()` (live, 10 bars) and `recordBars()` (on-demand, 100 bars); added `resolveRefreshSymbols()` tier-based resolver; added `getStatus()` for API; env-configurable via `BAR_REFRESH_LIVE_LIMIT`, `BAR_REFRESH_RECORD_LIMIT`, `BAR_REFRESH_INTERVAL_MS`; removed `ALWAYS_SYMBOLS` hardcoded array
- `nest/src/modules/market-data/market-data.controller.ts` — Injected `BarRefreshService`; added `GET /api/market-data/bars/refresh/status`, `POST .../start`, `POST .../stop`, `POST /api/market-data/bars/record`

## Capability Map Entry

- **name:** BarRefresh Live vs Record Mode
- **persistence:** ephemeral (mode state in-memory, resets on restart)
- **uiSurfaces:** 0 (API-only; future Settings page)
- **pipeline:** none (data refresh, not scoring)
- **completion:** complete

## QA Test Entry

- **area:** Data / Bar Refresh
- **name:** Live refresh uses reduced bar limit, record mode on-demand
- **procedure:** `GET /api/market-data/bars/refresh/status` — verify `liveLimit=10`, `recordLimit=100`. Check NestJS logs for live refresh: "LIVE bar refresh every 300s (limit=10 bars)". `POST /api/market-data/bars/record` — triggers bulk fetch, verify logs show "RECORD refresh: N symbols, limit=100 bars". Set `BAR_REFRESH_LIVE_LIMIT=5` env → restart → verify status shows `liveLimit=5`.
- **expected:** Live cycles fetch 10 bars/symbol (not 100). Record mode uses 100 bars. Start/stop toggles the timer. Status endpoint reflects current state.

## Architecture Framework Entry

- **section:** data
- **summary:** BarRefresh Live/Record Mode — `refresh()` fetches 5-10 bars for positions + active strategy symbols every 5min (live, directive-feeding). `recordBars()` fetches 100 bars for all active DB symbols on-demand (backtesting). Symbol resolution uses tier-based approach: open positions → active trading strategies → floor forex pairs. Config via `BAR_REFRESH_LIVE_LIMIT` (default 10), `BAR_REFRESH_RECORD_LIMIT` (default 100), `BAR_REFRESH_INTERVAL_MS` (default 300000). Files: bar-refresh.service.ts, market-data.controller.ts. Endpoints: `GET/POST /api/market-data/bars/refresh/*`, `POST /api/market-data/bars/record`.
