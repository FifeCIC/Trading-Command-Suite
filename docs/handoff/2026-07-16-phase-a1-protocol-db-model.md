# Handoff — Phase A.1: Protocol DB Model + Seed (2026-07-16)

## Agent
DeepSeek V4 Pro (primary agent)

## Epic
#398 — META.Stack Architecture Refactor

## Summary
Created DB-backed Protocol models and seeded them from the hardcoded PROTOCOL_REGISTRY. This is the schema foundation for the entire META.Stack refactor.

## What was done

### 1. Prisma schema — 4 new models
**File:** `nest/prisma/schema.prisma`

- `Protocol` — core protocol table (slug, name, description, directionMode, tradingStyle, seasonalAffinity, etc.)
- `ProtocolDirectiveGroup` — protocol's directive groups with weights, risk gate config (unique on protocolId+groupId)
- `ProtocolDirectiveEntry` — individual directive within a group with per-directive maxScore override (unique on groupId+directiveId)
- `SymbolProtocolAssignment` — symbol→protocol mapping replacing hardcoded SYMBOL_PROTOCOL_MAP (unique on symbol+protocolId)

All models have proper FK cascades (Cascade on delete).

### 2. Seed script
**File:** `nest/prisma/seed-protocols.ts`

Reads PROTOCOL_REGISTRY, DIRECTIVE_GROUPS, SHORT_DIRECTIVE_GROUPS, BTC_SPEED_GROUPS, and SYMBOL_PROTOCOL_MAP. Uses upsert for idempotency. Safe to run multiple times.

**Results:** 37 protocols, 111 directive groups, 542 directive entries, 16 symbol→protocol assignments seeded.

### 3. Prisma config
**File:** `nest/prisma.config.ts` — updated for Prisma 7 compatibility (not yet activated — local Prisma is 5.22.0)

## What still uses the hardcoded registry (unchanged)
- `nest/src/modules/directives/directive-groups.ts` — PROTOCOL_REGISTRY still exists and is still the runtime source
- `nest/src/modules/scoring/protocol-gating.service.ts` — still reads from PROTOCOL_REGISTRY
- `nest/src/modules/automation/automation-loop.service.ts` — still uses hardcoded protocol IDs
- `nest/src/modules/scoring/speed-scan.service.ts` — still uses hardcoded SYMBOL_PROTOCOL_MAP

**This is by design.** Phase A only creates the DB foundation. Phase B will redirect the code to read from DB.

## Verification
- Schema pushed to MySQL ✅
- Prisma client regenerated ✅
- Seed ran successfully ✅
- NestJS builds ✅
- NestJS starts and trades (Ticks:1, 22 active strategies) ✅

## Next
Phase A.2: Add `scoringStrategyId` FK to `TradingStrategy` (#400)
