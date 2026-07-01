# DA001 — Database Table Stats Endpoint & Version Tracking

**Agent:** tcs-dev
**Area:** Data / Backend
**Priority:** P2 — backend endpoint needed
**Depends on:** NestJS backend, MySQL information_schema

## Current State

`DatabaseTablesPage.jsx` now shows Version, Last Insert, and phpMyAdmin link columns. The Last Insert column queries `/api/database/table-stats` which doesn't exist yet (falls back to "—").

## Task

### Phase 1: Create `/api/database/table-stats` Endpoint
- New NestJS controller or service method
- For each active Prisma model, query `MAX(createdAt)` / `MAX(updatedAt)` 
- Return `{ tables: { ModelName: { lastInsert, lastUpdate, rowCount } } }`
- Handle tables without timestamp columns gracefully

### Phase 2: Version Tracking
- Prisma doesn't have built-in table versioning
- Option A: Add `SchemaVersion` table to track changes
- Option B: Migrate from `db push` to `prisma migrate` for proper migration history
- Currently showing Prisma version as proxy — improve this

### Phase 3: External Viewer Preference
- phpMyAdmin links work at `http://localhost/phpmyadmin/`
- Consider adding UserPreference for preferred external viewer
- Alternatives: TablePlus, DBeaver, MySQL Workbench

## Database Info
- **Engine**: MySQL 9.1 (WAMP)
- **Database**: tradingcs
- **ORM**: Prisma 5.22.0
- **Schema**: nest/prisma/schema.prisma
