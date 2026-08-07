# Handoff: #589 Phase 1 — Final items (hotStock + broker config)

**Date:** 2026-08-06
**Agent:** Copilot (TCS-Dev)
**Issue:** [#589](https://github.com/FifeCIC/Trading-Command-Suite/issues/589)

## What changed

### 1. hotStock columns on ScoringStrategy

**Schema:** Added 4 columns to `ScoringStrategy` model, mirroring `TradingStrategy`:
- `hotStockEnabled Boolean @default(false)`
- `hotStockAllocation Float?`
- `hotStockDetectionMode String? @db.VarChar(20)`
- `hotStockMaxHoldHours Int?`

**Migration:** `prisma db push` applied successfully. Both `scoring_strategy` and new `broker_config` table created.

### 2. Broker config persistence

**New table:** `broker_config` with columns: `id` (brokerId PK), `displayName`, `supportedStyles` (JSON), `supportedAssetTypes` (JSON), `tradingEnabled`, `note`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`.

**New service:** `nest/src/modules/trading/broker-config.service.ts`
- `OnModuleInit` — seeds 4 default brokers (mt5, trading212, paper, capital.com) if table is empty
- `findAll()` — returns all active brokers ordered by sortOrder
- `findOne(id)` — single broker lookup
- `isCompatible(brokerId, style, assetType)` — compatibility check
- Falls back to hardcoded defaults if DB unavailable

**New controller:** `nest/src/modules/trading/broker-config.controller.ts`
- `GET /api/brokers` — list all broker configs
- `GET /api/brokers/:id` — single broker config

**Registered in:** `TradingModule` (controllers + providers + exports)

### 3. Frontend — StrategyCreatePage now reads from API

`src/pages/StrategyCreatePage.jsx`:
- Added `useQuery` fetching `/api/brokers` (cached 5 min)
- `brokerMap` built from API response, falls back to `BROKER_FALLBACK`
- `BROKER_LIST` derived from `brokerMap` keys
- Hardcoded `PROTOCOL_BROKER_MAP` renamed to `BROKER_FALLBACK` and used only as fallback
- Old `CreateStrategyPage.jsx` left with hardcoded map (it's labeled "(old)" in nav)

## #589 — Final status

| Item | Status |
|------|--------|
| TradingStrategyService.create() drops fields | ✅ Fixed (Phase 1a) |
| active hardcoded false | ✅ Fixed (Phase 1a) |
| Protocol toggle (active column + raw SQL) | ✅ Fixed (Phase 1a) |
| maxPyramidTiers/slTpInheritance sent to wrong endpoint | ✅ Fixed (Phase 1b) |
| watchlistId silently dropped — auto-creates ScoringStrategy | ✅ Fixed (Phase 1b) |
| hotStock on ScoringStrategy | ✅ Fixed (Phase 1c) |
| Broker config persistence | ✅ Fixed (Phase 1c) |

## Verification

- ✅ Backend build: `tsc -p tsconfig.build.json` — clean
- ✅ Frontend build: `vite build` — clean
- ✅ DB migration: `prisma db push` — `scoring_strategy` hotStock columns + `broker_config` table created
- ✅ Seeds: BrokerConfigService seeds 4 default brokers on module init
