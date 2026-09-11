---
date: 2026-09-11
area: infra
type: bugfix
---

## What Changed

Made the VIX short instrument restorable from a fresh install (it was DB-only), fixed a `symbol_route.provider` schema omission, fixed two seeding defects that would have produced a non-functional seeded bot, and added a mandatory agent rule that a direct database write is not a completed change.

## Files Changed

- `nest/prisma/seed-symbol-onboarding.ts` — added VIX symbol + route to the declarative lists; `upsert` now carries `provider` and `brokerSymbol` on **update** as well as create (a re-seed previously could not repair a missing `brokerSymbol`); documented that this file is the ONLY seed path for `symbol_route`
- `nest/prisma/schema.prisma` — added the missing `provider` field to `model SymbolRoute`. The column exists in the DB but was absent from the model, so Prisma could not read or write it. Caught by `prisma db pull --print`.
- `nest/src/modules/trading/strategy-seed-data.ts` — added the VIX short bot to `DEFAULT_TRADING_STRATEGIES`; added `requireDirection` to `SeedTradingStrategy`
- `nest/src/modules/trading/trading-strategy.service.ts` — `seedDefaults()` now sets `requireDirection`, and derives `strategy_protocol.role` from the protocol slug instead of hardcoding `'long'`
- `.github/instructions/database-seed-discipline.instructions.md` — NEW mandatory rule

## Capability Map Entry

- **name:** Seed-restorable trading configuration
- **persistence:** config
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Infrastructure
- **name:** VIX short bot and route survive a fresh install
- **procedure:** `DELETE FROM symbol_route WHERE symbol='VIX'` and delete the VIX `trading_strategy` row + its `strategy_protocol` subscription; then run `npx ts-node prisma/seed-symbol-onboarding.ts` and `POST /api/trading/strategies/seed`
- **expected:** Both rows return; the bot has `requireDirection='SELL'`, and a `strategy_protocol` row with `role='short'` exists, so the `syncQueues()` subscription query matches it

## Architecture Framework Entry

- **section:** data
- **summary:** DB-only config tables. `symbol_route` has exactly one seed path (`seed-symbol-onboarding.ts`) and one other writer (`Mt5Controller`, an API call) — anything not in the seeder is lost on reinstall. `trading_strategy` seeds from `strategy-seed-data.ts`. Queue routing is by `strategy_protocol` SUBSCRIPTION, not by `trading_strategy`, and `POST /api/trading/strategies` does not create that subscription — so an API-created bot silently never trades. Guarded by `.github/instructions/database-seed-discipline.instructions.md`.

## Why this matters (the engineering reasoning)

**A direct DB write is a change to one machine, not to the project.** The seed files are the
durable artefact; the database is a cache of them. Two opposite silent failures follow:

- Add only to DB → **lost forever** on reinstall.
- Remove from seed → **cannot be shed**, because no seeder contains a delete.

**Three separate defects had to be fixed before a reinstall would produce a *working* bot** —
"present" was not the same as "functional", and only a delete-and-rebuild test distinguished them:

1. `strategy_protocol.role` was hardcoded `'long'`, so the only SHORT bot would have been routed as long.
2. The seeder had no `requireDirection`, so a seeded short bot had no declared direction.
3. `upsert.update` omitted `brokerSymbol`, so a re-seed restored `null` instead of the verified ticker — the "restored" row was not a faithful copy of what worked.

**Verified by full round-trip (delete → seed → compare):** all six checks pass — bot restored, `mode=auto`, `active`, `requireDirection=SELL`, subscription restored, `role=short`.

## Not done / limitations

- **The 4 binance crypto routes (BTC/DOGE/ETH/SOL, `brokerId: 0`, `provider: 'binance'`) are still unseeded.** They are documented in the seeder with a comment explaining they need their own seeder (they are not MT5 routes and must not be mixed into the MT5 `ROUTES` list). **They will still be lost on reinstall.** A follow-up issue is needed.
- **`global_setting` has no seeder at all** — settings remain DB-only.
- **`watchlist` / `watchlist_item` restoration is UNVERIFIED.** `watchlist_item` was empty when checked, so I could not confirm the path works. Not claimed.
- **The automation loop is not ticking** (found during #772) — newest `decision_log` row is 30 hours old while `protocol_score_status` is seconds old. Not investigated; may be expected from `build:api` restarts resetting `tradingEnabled`.
