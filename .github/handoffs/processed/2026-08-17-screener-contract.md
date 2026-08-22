---
date: 2026-08-17
area: data
type: feature
---

## What Changed

Defined the Phase 2 screener contract — a source-agnostic "attention" model with no market-data or scoring dependency. Two new entities, documented, with idempotent table bootstrap matching the existing `scheduled_job` / `ab_test` pattern.

## Files Changed

- nest/prisma/schema.prisma — new `ScreenerHit` model (ticker, symbolId?, source, catalystType, catalystStrength, sourceReliability, rawPayloadRef, timestamp) and `WatchlistItem` model (watchlistId?, ticker, symbolId?, status new|watching|promoted|expired, source?, screenerHitId?, promotedTo?, promotedAt?, expiresAt?). `Watchlist` gained `items WatchlistItem[]`.
- nest/src/database/prisma.service.ts — added `screener_hit` and `watchlist_item` CREATE TABLE IF NOT EXISTS to `bootstrapSchema()`.
- docs/SCREENER-CONTRACT.md — the contract: attention ≠ conviction, ScreenerHit field table, watchlist lifecycle state machine, out-of-scope phases.
- Prisma client regenerated (v5.22.0 local).

## Capability Map Entry

- **name:** ScreenerHit + WatchlistItem contract
- **persistence:** screener_hit, watchlist_item (bootstrap DDL)
- **uiSurfaces:** 0
- **pipeline:** data
- **completion:** complete

## QA Test Entry

- **area:** Data / Screener
- **name:** Screener tables bootstrapped
- **procedure:** restart backend; `SHOW TABLES LIKE 'screener_hit'` and `'watchlist_item'`
- **expected:** both exist (verified true on 2026-08-17).

## Architecture Framework Entry

- **section:** data
- **summary:** The screener is an *input surface* + *output destination*, not a new engine. `ScreenerHit` = one normalised catalyst event (attention), `WatchlistItem` = the attention lifecycle. Directional conviction is computed later by the existing scoring engine after handover. No market data or scores live in this layer; attention weight is computed (Phase 3, #647), never stored.
