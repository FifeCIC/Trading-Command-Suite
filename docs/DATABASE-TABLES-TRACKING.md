# Database Tables — External Viewer & Tracking

**Created**: 2026-06-30
**Status**: Discussion
**Page**: `/data/database-tables`

---

## Current State
The Database Tables page now shows:
- Table name, description, status, row count
- Version column (Prisma version)
- Last Insert column (requires `/api/database/table-stats` backend endpoint — currently returns "—")
- phpMyAdmin link per active table

## Database Technology
- **Confirmed**: MySQL 9.1 (WAMP) with Prisma 5.22.0 ORM
- Database name: `tradingcs`
- Schema file: `nest/prisma/schema.prisma`
- Migrations applied via `npx prisma db push` (not Prisma Migrate — schema is pushed directly)

## Open Questions

### Version Tracking
- Prisma doesn't have built-in table versioning
- Options:
  1. Track Prisma schema version / migration count
  2. Add a `SchemaVersion` table to track changes
  3. Use Prisma Migrate instead of `db push` for proper migration history
- Currently showing Prisma version as a proxy

### Last Insert Tracking
- MySQL `information_schema` doesn't track per-table last insert time
- Options:
  1. Add `updatedAt` columns to all tables (some already have them)
  2. Create a `/api/database/table-stats` endpoint that queries `MAX(createdAt)` / `MAX(updatedAt)` per table
  3. Use MySQL `UPDATE_TIME` from `information_schema.tables` (only works for MyISAM, not InnoDB)

### External Viewer
- phpMyAdmin is available at `http://localhost/phpmyadmin/`
- Direct table links added: `http://localhost/phpmyadmin/index.php?route=/table/sql&db=tradingcs&table=TableName`
- Alternative: TablePlus, DBeaver, MySQL Workbench — but phpMyAdmin is zero-config
- Should we add a preference for which external viewer to use?

## Next Steps
1. Create `/api/database/table-stats` endpoint to query real last-insert timestamps
2. Consider migrating from `db push` to `prisma migrate` for versioned schema history
3. Add external viewer preference to UserPreferences
