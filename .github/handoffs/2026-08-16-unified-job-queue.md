---
date: 2026-08-16
area: automation
type: feature
---

## What Changed

Added the Phase 0 groundwork for a unified DB-driven job queue (#614): a `ScheduledJob` table, a `JobQueueService` with `pollDueJobs()`/`processJob()` (priority ordering, retry backoff, interval rescheduling), and a once-per-tick poll call from the automation loop. No orchestration yet — handlers are registered per job type and none are wired (deliberately).

## Files Changed

- nest/prisma/schema.prisma — `ScheduledJob` model mapped to `scheduled_job`
- nest/src/database/prisma.service.ts — `CREATE TABLE IF NOT EXISTS scheduled_job` bootstrap DDL (avoids `prisma db push` touching pre-existing tables)
- nest/src/modules/automation/job-queue.service.ts — new `JobQueueService` (poll/process/enqueue/enqueueInterval)
- nest/src/modules/automation/automation-loop.service.ts — calls `pollDueJobs()` non-blocking at tick start
- nest/src/modules/automation/automation.module.ts — registered + exported `JobQueueService`

## Capability Map Entry

- **name:** Unified Job Queue (Phase 0)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Automation
- **name:** Job queue poll + retry lifecycle
- **procedure:** Insert a `scheduled_job` row with `runAt` in the past, trigger `POST /api/automation/run-now`, then read the row
- **expected:** Row is picked up, `attempts` increments, an unregistered type records `lastError` ("No handler registered…") and returns to `queued` with a 30s backoff (retries until `maxAttempts`, then `failed`).

## Architecture Framework Entry

- **section:** routes
- **summary:** Unified Job Queue — `scheduled_job` table + `JobQueueService` (pollDueJobs/processJob with priority, retry backoff, interval rescheduling) polled once per automation tick. Key files: `job-queue.service.ts`, `automation-loop.service.ts`, `prisma.service.ts` (bootstrap DDL). No handlers registered yet (Phase 0).
