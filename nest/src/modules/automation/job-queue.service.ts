import { Injectable, Logger } from '@nestjs/common';
import { ScheduledJob } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Unified Job Queue — Phase 0 groundwork (#614).
 *
 * A DB-driven job table the automation loop polls every tick. This gives a
 * single scheduling model that future phases (cooldowns, priority,
 * session-aware orchestration) build on. Phase 0 deliberately does NOT absorb
 * the existing four mechanisms (automation loop, scoring scheduler, execution
 * queue, BullMQ import jobs) — it only adds the queue mechanics.
 *
 * Job lifecycle:
 *   queued → running → complete        (one-time)
 *   queued → running → queued(runAt+ms) (permanent 'interval' jobs)
 *   queued → running → failed          (attempts exhausted)
 *
 * Handlers are registered per job.type and dispatched to existing services.
 */
@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  /** Max jobs processed per poll — keeps the tick bounded. */
  private static readonly MAX_PER_POLL = 25;
  /** Retry backoff for failed one-time jobs before they're retried. */
  private static readonly RETRY_BACKOFF_MS = 30_000;

  /** Handler map: job type → async processor. Returns void (throws on failure). */
  private readonly handlers = new Map<string, (job: ScheduledJob) => Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Register a processor for a job type (e.g. 'score-protocol'). */
  registerHandler(type: string, handler: (job: ScheduledJob) => Promise<void>): void {
    this.handlers.set(type, handler);
  }

  /**
   * Poll for due jobs and process them. Called by the automation loop each tick.
   * Returns the jobs that were due this poll (already processed).
   */
  async pollDueJobs(): Promise<ScheduledJob[]> {
    if (!this.prisma.isAvailable) return [];

    const now = new Date();
    let due: ScheduledJob[];
    try {
      due = await this.prisma.scheduledJob.findMany({
        where: {
          status: 'queued',
          runAt: { lte: now },
        },
        orderBy: [{ priority: 'desc' }, { runAt: 'asc' }],
        take: JobQueueService.MAX_PER_POLL,
      });
    } catch (err) {
      this.logger.warn(`pollDueJobs query failed: ${(err as Error).message}`);
      return [];
    }

    for (const job of due) {
      await this.processJob(job);
    }
    if (due.length > 0) {
      this.logger.log(`JobQueue: processed ${due.length} due job(s) [${due.map((j) => j.type).join(', ')}]`);
    }
    return due;
  }

  /** Process a single job: mark running, dispatch, complete or reschedule. */
  async processJob(job: ScheduledJob): Promise<void> {
    try {
      await this.prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'running', attempts: { increment: 1 }, lastRunAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Could not mark job ${job.id} running: ${(err as Error).message}`);
      return;
    }

    try {
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type "${job.type}"`);
      }
      await handler(job);
    } catch (err) {
      // Failed — retry if attempts remain, else mark failed.
      const attempts = job.attempts + 1; // we already incremented in the running update
      const final = attempts >= job.maxAttempts;
      await this.prisma.scheduledJob
        .update({
          where: { id: job.id },
          data: {
            status: final ? 'failed' : 'queued',
            lastError: String((err as Error).message ?? err),
            runAt: new Date(Date.now() + JobQueueService.RETRY_BACKOFF_MS),
          },
        })
        .catch((uerr) => this.logger.warn(`Job ${job.id} status update failed: ${(uerr as Error).message}`));
      this.logger.warn(`Job ${job.id} (${job.type}) failed (attempt ${attempts}/${job.maxAttempts}): ${(err as Error).message}`);
      return;
    }

    // Success — complete one-time jobs, reschedule permanent 'interval' jobs.
    if (job.recurrence === 'interval' && job.recurrenceMs) {
      await this.prisma.scheduledJob
        .update({
          where: { id: job.id },
          data: {
            status: 'queued',
            runAt: new Date(Date.now() + job.recurrenceMs),
            lastRunAt: new Date(),
            lastError: null,
          },
        })
        .catch((uerr) => this.logger.warn(`Job ${job.id} reschedule failed: ${(uerr as Error).message}`));
    } else {
      await this.prisma.scheduledJob
        .update({
          where: { id: job.id },
          data: { status: 'complete', lastRunAt: new Date(), lastError: null },
        })
        .catch((uerr) => this.logger.warn(`Job ${job.id} complete update failed: ${(uerr as Error).message}`));
    }
  }

  /** Enqueue a one-time job. Convenience for callers (tests, controllers, seeds). */
  async enqueue(params: {
    type: string;
    priority?: number;
    runAt?: Date;
    payload?: Record<string, any>;
    maxAttempts?: number;
  }): Promise<ScheduledJob | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      return await this.prisma.scheduledJob.create({
        data: {
          type: params.type,
          priority: params.priority ?? 50,
          runAt: params.runAt ?? new Date(),
          payload: params.payload ?? undefined,
          maxAttempts: params.maxAttempts ?? 3,
        },
      });
    } catch (err) {
      this.logger.warn(`enqueue failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Enqueue a permanent interval job (reschedules itself after each run). */
  async enqueueInterval(params: {
    type: string;
    intervalMs: number;
    priority?: number;
    payload?: Record<string, any>;
    maxAttempts?: number;
  }): Promise<ScheduledJob | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      return await this.prisma.scheduledJob.create({
        data: {
          type: params.type,
          priority: params.priority ?? 50,
          runAt: new Date(Date.now() + params.intervalMs),
          recurrence: 'interval',
          recurrenceMs: params.intervalMs,
          payload: params.payload ?? undefined,
          maxAttempts: params.maxAttempts ?? 3,
        },
      });
    } catch (err) {
      this.logger.warn(`enqueueInterval failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** List recent jobs for inspection (newest first). */
  async getJobs(limit = 50, status?: string): Promise<ScheduledJob[]> {
    if (!this.prisma.isAvailable) return [];
    try {
      return await this.prisma.scheduledJob.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
      });
    } catch (err) {
      this.logger.warn(`getJobs failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Aggregate queue stats: counts by status + next due job. */
  async getStats(): Promise<Record<string, number | string | null>> {
    if (!this.prisma.isAvailable) return {};
    try {
      const grouped = await this.prisma.scheduledJob.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const stats: Record<string, number | string | null> = {};
      for (const g of grouped) stats[g.status] = g._count._all;
      const next = await this.prisma.scheduledJob.findFirst({
        where: { status: 'queued' },
        orderBy: [{ runAt: 'asc' }],
        select: { runAt: true, type: true },
      });
      stats.nextDueAt = next?.runAt?.toISOString() ?? null;
      stats.nextDueType = next?.type ?? null;
      return stats;
    } catch (err) {
      this.logger.warn(`getStats failed: ${(err as Error).message}`);
      return {};
    }
  }
}
