---
date: 2026-07-18
area: data
type: feature
---

## What Changed

Replaced the monolithic "every 6h, all symbols" news import with a tiered priority system and daily article budget (~100/day cap), preventing the 2,127-article flood that occurred at 1am.

## Files Changed

- `nest/src/modules/news/news-import.service.ts` — Replaced `GIANT_SYMBOLS` with tier-based symbol lists (`MACRO_SYMBOLS`, `SECTOR_SYMBOLS`); replaced `@Cron('0 */6 * * *')` with hourly tiered dispatcher; added `resolveTierSymbols()`, `runTierImport()`, `getDailyArticleCount()`, `getTierConfig()`, `getNewsStats()`, `bumpTierCount()`; injected `SettingsService`
- `nest/src/modules/news/news.controller.ts` — Added `GET /api/news/stats` endpoint returning daily budget, per-tier counts, and last run info
- `nest/src/modules/news/news.module.ts` — Imported `SystemModule` for `SettingsService`
- `nest/src/modules/system/settings.service.ts` — Extended `AppSettings` with `newsImport: NewsImportSettings`; added `NewsTierConfig` and `NewsImportSettings` interfaces with defaults
- `nest/prisma/schema.prisma` — Added `tierId VARCHAR(50)` column + index to `NewsImportRun`

## Capability Map Entry

- **name:** News Import Tier System
- **persistence:** stored (settings in AppSetting DB table), config (tier config via SettingsService)
- **uiSurfaces:** 0 (API-only; Settings page UI is future work per issue scope)
- **pipeline:** none (data import, not scoring)
- **completion:** partial (Settings UI editable via PUT /api/system/settings already, but no dedicated settings panel widget yet)

## QA Test Entry

- **area:** Data / News Import
- **name:** Tiered news import respects daily budget and tier intervals
- **procedure:** `GET /api/news/stats` — verify `today.limit=100`, 5 tiers present with individual limits. Wait for next hourly cron tick — verify only due tiers fire. Check `GET /api/news/stats` shows tier counts incrementing. Manually `POST /api/news/import/run` — verify legacy full import still works.
- **expected:** Cron no longer floods 2K+ articles at once; tiers dispatch on their configured intervals; daily budget halts all imports when exhausted; per-tier limits enforced in-memory.

## Architecture Framework Entry

- **section:** data
- **summary:** News Import Tier System — Tiered priority model (positions→protocols→macro→sector→other) replaces the old monolithic GIANT_SYMBOLS approach. Each tier has independent maxPerDay and intervalMin, configurable via `PUT /api/system/settings { newsImport: {...} }`. Hourly cron (`@Cron('0 * * * *')`) dispatches only due tiers. Daily budget (default 100 articles) enforced globally. In-memory tracking for tier last-run times and daily counts (resets on restart — acceptable for rate limiting). Files: news-import.service.ts, settings.service.ts, news.controller.ts. Endpoints: `GET /api/news/stats` (dashboard), `GET /api/news/tracked-symbols` (resolves per-tier).
