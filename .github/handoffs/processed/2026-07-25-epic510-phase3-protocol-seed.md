# Handoff: Epic #510 Phase 3 — Protocol Seed to DB

**Date:** 2026-07-25  
**Agent:** DeepSeek V4 Pro  
**GitHub Issue:** Epic #510 (Phase 3 of 4)

## Summary
Seeded all 37 hardcoded protocols from `PROTOCOL_REGISTRY` into the database.  
Followed same pattern as Phase 1 directive seed (`seedToDatabase` → upsert into `directive` table).

## Files Changed

### `nest/src/modules/scoring/protocol-db.service.ts`
- Added `seedProtocolsToDatabase()` method (idempotent, uses upsert on 3 tables)
- Iterates `PROTOCOL_REGISTRY` entries — for each protocol slug+config:
  - Upserts into `protocol` table (slug, name, description, directionMode, tradingStyle, etc.)
  - Upserts groups into `protocol_directive_group` (protocolId, groupId, name, weight, isRiskGate, minMultiplier, maxMultiplier, sortOrder)
  - Upserts entries into `protocol_directive_entry` (groupId, directiveId, maxScore, active=true)
- Catches per-protocol errors and logs warnings

### `nest/src/modules/scoring/protocol-gating.controller.ts`
- Added `POST /api/scoring/gated/protocols/seed` endpoint
- Delegates to `ProtocolDbService.seedProtocolsToDatabase()`

## Verification

```
POST /api/scoring/gated/protocols/seed
→ {"seeded":37,"groups":111,"entries":540}

Second run (idempotency check):
→ {"seeded":37,"groups":111,"entries":540}
```

## DB State
| Table | Row Count |
|-------|-----------|
| protocol | 37 |
| protocol_directive_group | 111 |
| protocol_directive_entry | 540 |

## What's Next (Phase 4)
- Remove `PROTOCOL_REGISTRY` fallback in `getCached()`/`getAllCached()` (switch to DB-only)
- Switch `preloadAll()` to read from DB only
- Delete the hardcoded registry (~1,730 lines)
