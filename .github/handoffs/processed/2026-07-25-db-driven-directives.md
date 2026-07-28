---
date: 2026-07-25
area: data
type: feature
---

## What Changed

Epic #510 Phase 1 + 2: Seeded 102 hardcoded directives into the DB `directive` table. Added `DirectivesService.seedToDatabase()` method and `POST /api/directives/seed` endpoint (idempotent upsert). Added `loadDirectiveMetadata()` which reads directive metadata from DB at startup and overlays active status, weight overrides, and config onto the in-memory registry. Algorithm code (`calculate()`) stays in TypeScript — only metadata goes to DB.

## Files Changed

- `nest/src/modules/directives/directives.service.ts` — Added `seedToDatabase()` (+55 lines) and `loadDirectiveMetadata()` (+60 lines). Replaced `refreshActiveStatuses()` call with `loadDirectiveMetadata()` which does everything the old method did plus weight/config overlay.
- `nest/src/modules/directives/directives.controller.ts` — Added `POST /api/directives/seed` endpoint (+6 lines)
- `nest/src/modules/directives/directives.module.ts` — Changed `refreshActiveStatuses()` → `loadDirectiveMetadata()` call in `onModuleInit()`

**DB State:**
- `directive` table: 102 rows populated with id, name, weight, config (JSON: description, directionBias, version), active=true, isDefault=true, nature set
- 3 directives marked inactive from DB (overrides class defaults)

**Re-seed is idempotent and safe:**
```bash
curl -X POST http://localhost:3201/api/directives/seed
# {"seeded":102,"skipped":0}
```

## Capability Map Entry

- **name:** DB-Driven Directive Configuration
- **persistence:** stored
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** partial (Phase 2 of 6)

## QA Test Entry

- **area:** Data / Directives
- **name:** Verify directives load from DB at startup
- **procedure:** Restart NestJS. Check log for "Directive metadata loaded from DB: 102 directives, X weight overrides, Y inactive". Change one directive's active status in DB. Restart. Verify the directive is skipped in scoring.
- **expected:** Startup log shows 102 directives loaded. Inactive directives are skipped during scoring (no score contributed).

## Architecture Framework Entry

- **section:** directives
- **summary:** Directives are now DB-backed for metadata (active status, weight, config). Algorithm code remains in TypeScript class files. Seed endpoint (`POST /api/directives/seed`) is idempotent. Future phases will seed protocols and remove the hardcoded PROTOCOL_REGISTRY entirely. See Epic #510.
