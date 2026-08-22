---
date: 2026-08-20
area: signals
type: feature
---

## What Changed

Screener catalyst ingestion (#648) — real news/earnings feeds mapped into
`ScreenerHit`s (the #645 contract) for the Signals area.

- nest/src/modules/screener/ — new module:
  - ScreenerService: maps RSS `news_item` rows + Finnhub `newsarticle` rows
    into `news-mention` hits, and `earnings_event` calendar rows into
    `earnings-date` hits (proximity-weighted strength). Dedupe by
    (source, ticker, rawPayloadRef). 5-min cron + boot run.
  - ScreenerController: `GET /api/screener/hits` + `POST /api/screener/ingest`.
- nest/src/database/prisma.service.ts — `news_item` bootstrap DDL (was missing:
  RSS scraper writes silently vanished).
- nest/prisma/schema.prisma — `NewsItem` model; `@@map("screener_hit")` and
  `@@map("watchlist_item")` fixes (Prisma was targeting wrong table names).

## Verification

- Live: `POST /api/screener/ingest` → `news: +193/197` hits from current RSS
  headlines (BAC, NVDA, AAPL, GOOGL); `GET /api/screener/hits` returns them.
- Earnings: 0 events — Alpha Vantage import logs "No adapter registered for
  id: alphavantage" (follow-up needed; noted on #648).

## Status

Issue #648 left OPEN with a progress comment — remaining: AV earnings adapter
registration, `earnings-proximity` catalyst rehoming, Finnhub news delay.

## Architecture Entries

- Route contracts: `GET /api/screener/hits`, `POST /api/screener/ingest` —
  owner: Screener catalyst ingestion (#648).
