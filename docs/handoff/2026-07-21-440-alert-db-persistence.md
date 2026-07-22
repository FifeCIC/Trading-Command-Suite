# Handoff — #440 Alert Center: Database Persistence (Prisma Model + Service Migration)

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#440](https://github.com/FifeCIC/Trading-Command-Suite/issues/440)

## What Changed

### Prisma Alert Model
Added `Alert` model to `prisma/schema.prisma`:
- Fields: id, type, title, detail, severity, ticker, link, acknowledged, dismissed, snoozedUntil, createdAt, readAt
- Indexes: `[type, createdAt]`, `[acknowledged, createdAt]`

### AlertsService — In-Memory → Database
- **Removed**: in-memory `alerts[]` array, `idCounter`, `seedAlerts()`, `makeAlert()`, `simulateAlert()`, `setInterval` simulation
- **Added**: PrismaService injection, async DB-backed methods:
  - `getActiveAsync()` — queries DB with dismissed/snooze filters
  - `acknowledge(id)` — updates alert `acknowledged: true, readAt: now`
  - `dismiss(id)` — updates alert `dismissed: true`
  - `getAlertCount()` — real counts from DB (active, critical)
  - `addAlert(type, title, detail, severity, ticker, link)` — creates persistent alert
- Config remains in-memory (configs are read-only defaults)

### AlertsController — Async Updates
- `GET /active` → async, uses `getActiveAsync()`
- `GET /count` → async, uses `getAlertCount()`
- `POST /:id/acknowledge` → async
- `POST /:id/dismiss` → async
- Snooze — returns not-implemented (was previously in-memory only)

### Files Changed
- `nest/prisma/schema.prisma` — added Alert model
- `nest/src/modules/alerts/alerts.service.ts` — DB-backed service
- `nest/src/modules/alerts/alerts.controller.ts` — async controller methods

### DB Push
- Schema validated ✅
- `db push` deferred (pre-existing FK issue)

### Build Verification
- NestJS: `tsc` — clean
- Prisma validate: schema is valid
