# Phase 0 — Unified Job Queue Groundwork

> **Parent epic:** [#417](https://github.com/FifeCIC/Trading-Command-Suite/issues/417) — Unified Task Scheduling API
> **Status:** Planning / Discussion
> **Scope:** Low-risk groundwork only — no orchestration, no cooldowns, no session-awareness

---

## Goal

Lay the foundation for a DB-driven job queue that the automation loop can poll every ~10s. This gives us a single scheduling model that all future phases (cooldowns, priority, session-aware orchestration) build on — instead of the four separate mechanisms that exist today.

## Current mechanisms (to be unified later)

| Mechanism | Tech | Location |
|-----------|------|----------|
| Automation loop tick | `setInterval` 2min | `automation-loop.service.ts` |
| Scoring scheduler | `setTimeout` 5min | `scoring-scheduler.service.ts` |
| Execution queue | In-memory v1 | `execution-queue.service.ts` |
| Import jobs | BullMQ (dormant — no Redis) | `import-jobs/` |

**Phase 0 does NOT absorb these.** It only adds the DB job table + a poller stub. Absorption happens in Phase 4 once the model is proven.

---

## Job Model (DB table)

```prisma
model ScheduledJob {
  id            String   @id @default(uuid()) @db.VarChar(36)
  type          String   @db.VarChar(50)     // 'score-protocol' | 'import-data' | 'execute-trade' | 'fetch-bars'
  status        String   @default("queued")  @db.VarChar(20) // queued | running | complete | failed | cancelled
  priority      Int      @default(50)        // 0-100, higher runs first
  runAt         DateTime @default(now())     // next time this job is due
  recurrence    String?  @db.VarChar(20)     // null = one-time | 'interval' | 'cron'
  recurrenceMs  Int?                         // for 'interval' — ms between runs (permanent jobs)
  payload       Json?                        // job-specific data (symbol, protocolId, etc.)
  attempts      Int      @default(0)
  maxAttempts   Int      @default(3)
  lastRunAt     DateTime?
  lastError     String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([status, runAt])
  @@index([type])
  @@map("scheduled_job")
}
```

### Permanent vs one-time

- **One-time:** `recurrence = null` → runs once, then `complete`.
- **Permanent (reset):** `recurrence = 'interval'` + `recurrenceMs` → after running, `runAt` is advanced by `recurrenceMs` and `status` returns to `queued`. Never deletes — this is the "always present" job.

---

## Poller stub

A method on the automation loop (or a new `JobQueueService`) that runs every tick:

```typescript
async pollDueJobs(): Promise<ScheduledJob[]> {
  const now = new Date();
  const due = await prisma.scheduledJob.findMany({
    where: {
      status: 'queued',
      runAt: { lte: now },
    },
    orderBy: [{ priority: 'desc' }, { runAt: 'asc' }],
    take: 25,
  });

  for (const job of due) {
    await this.processJob(job);
  }
  return due;
}

async processJob(job: ScheduledJob) {
  // Mark running
  await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: 'running', attempts: { increment: 1 } } });

  try {
    switch (job.type) {
      case 'score-protocol': /* ... */ break;
      case 'import-data':    /* ... */ break;
      // ... dispatched to existing services
    }
    // Complete or reschedule
    if (job.recurrence === 'interval' && job.recurrenceMs) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'queued', runAt: new Date(Date.now() + job.recurrenceMs), lastRunAt: new Date() },
      });
    } else {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: 'complete', lastRunAt: new Date() } });
    }
  } catch (err) {
    // Failed — retry if attempts remain, else mark failed
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: job.attempts >= job.maxAttempts ? 'failed' : 'queued',
        lastError: String(err),
        runAt: new Date(Date.now() + 30_000), // retry backoff
      },
    });
  }
}
```

---

## What Phase 0 delivers

1. `ScheduledJob` table (Prisma schema)
2. `JobQueueService` with `pollDueJobs()` + `processJob()`
3. The automation loop calls `pollDueJobs()` once per tick (currently 2min, later 10s)
4. No orchestration logic — just the queue mechanics

## What Phase 0 deliberately excludes

- Cooldowns (Phase 4 — #417)
- Session-aware priority (Phase 5 — #611)
- Absorbing ExecutionQueueService / ImportJobs into the model
- Redis/BullMQ migration — DB-backed first, BullMQ later if needed
- Loop interval change from 2min to 10s (that's a separate tuning decision, gated on scoring cost)

---

## Open questions for discussion

1. **Table name** — `ScheduledJob` vs `Task` vs `Job` vs `QueueJob`? Naming matters (#574 is already asking this for the execution queue).
2. **Recurrence format** — simple `recurrenceMs` (interval) vs cron expressions? Start with interval; add cron later.
3. **Concurrency** — single poller assumes one process. If we ever run multiple NestJS instances, we need row-level locking (`FOR UPDATE SKIP LOCKED`). Note as future concern.
4. **Payload validation** — loose `Json` vs per-type schemas? Start loose; tighten when types stabilise.
