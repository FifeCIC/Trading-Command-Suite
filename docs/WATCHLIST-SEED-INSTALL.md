# Seed Watchlists as Core Installation

**Status:** Deferred — do after core features are solid
**Created:** 2026-06-24

## Problem

Watchlist data is fragmented across 3 storage locations:

| Location | Used? |
|----------|-------|
| Filesystem `src/data/watchlists/*.json` | ✅ Controller reads/writes here |
| MySQL `watchlist` table | ❌ Exists but not used |
| MySQL `watchlistmeta` table | ❌ Exists but not used |

The filesystem approach works because it's backed up to git. But DB tables exist and are orphaned.

## Solution

1. Add a `seed:watchlists` Prisma script that creates default watchlists in the DB (Tech Giants, Forex Majors, Crypto Top 5, etc.)
2. Wire `WatchlistsController` to read from DB (`watchlist` + `watchlistmeta` tables) instead of filesystem
3. Keep filesystem as import source only (CSV import creates files, then syncs to DB)
4. Update `SETUP.md` seed section to include watchlist seeding
5. Fix `WatchlistsPage.jsx` — replace MOCK_WATCHLISTS with live `/api/watchlists` query (UI Data Honesty violation)
6. Update `PAGE_DATA_STATUS` — mark `user-watchlists` and `create-watchlist` as live instead of mock

## Why Deferred

Core trading functionality (scoring, backtesting, strategies) should work end-to-end before perfecting setup. The current filesystem approach works — data persists across restarts, is backed up to git, and the API serves it correctly. The DB consolidation is polish.
