# Handoff: Earnings Calendar Data + Import Settings (2026-08-22)

## Problem
/research/earnings-calendar showed nothing. Root cause: the Finnhub adapter was
registered with `enabled: false` (disabled 2026-07-10 "key expires too
quickly"). The configured FINNHUB_API_KEY is valid — direct calls return 500+
events per 30 days.

## What shipped (commit 53a1288)
1. **Finnhub re-enabled** in `providers.module.ts`.
2. **Chunked windows** in `finnhub.adapter.ts` — Finnhub caps responses at
   1500 events newest-first, so a single 90-day call silently returned only
   the last 15 days. The adapter now fetches 10-day windows (recursive split
   at 3-day granularity if a window still hits the cap). 3-month call now
   returns ~5,125 events covering the whole horizon.
3. **NasdaqEarningsService** (`research/nasdaq-earnings.service.ts`) —
   keyless fallback via api.nasdaq.com calendar. Per-trading-day fetch,
   6-hour in-memory cache, market-cap + session parsing. Guarantees the
   calendar is never empty when Finnhub fails.
4. **Import settings** (`earnings-import-settings.service.ts` +
   `dto/earnings-import-settings.dto.ts`) stored in global_setting:
   - `scope`: all | watchlist (union of watchlist.symbols + watchlist_item)
     | portfolio (Position symbols)
   - `minMarketCap`: USD floor — applied where the source provides it
     (Nasdaq does, Finnhub doesn't); unknown-cap events are kept
   - `timeOfDay`: all | bmo | amc
   - `horizonMonths`: 1–12, `autoImportEnabled`: bool, `sources`: order
5. **Import pipeline** (`research-import.service.ts`) — daily 07:00 cron
   honors settings (skips when autoImportEnabled=false); manual trigger
   forces. Filter drop-stats recorded in the import summary. Upserts in
   batches of 20 (5k+ events exceed HTTP timeouts sequentially).
6. **Endpoints**:
   - `GET/PUT /api/research/earnings/settings`
   - `POST /api/research/earnings/import` — fire-and-forget
   - `GET /api/research/earnings/status` — running, storedEvents,
     settings, lastImport
7. **Page UI** — collapsible Import Settings panel (scope chips, session
   chips, min cap in $B, horizon select, auto-import checkbox, Save /
   Import now / last-run status). Subtitle shows live source.

## DB state
- earnings_event: 5,533 events 2026-08-24 → 2026-11-20 (finnhub 5,125 +
  nasdaq 408). Imported before settings existed; lastImport records from now on.

## Notes
- The daily cron populates earnings_event; research-overview already
  cross-references positions against it (hasEarningsSoon).
- `earnings-proximity` directive stays alpha / out of protocols (#626/#648).
- Nasdaq `limit` param is ignored — always 20 rows/day; weekend rows are null.
- Backend start: use Start-Process detached (`node dist\src\main.js`,
  WorkingDirectory nest) so it survives terminal cleanup.
