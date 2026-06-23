/**
 * Execution Queue Service
 * =======================
 * Manages sequential execution of ProtocolRun jobs. Only one job
 * runs at a time. Same protocolId cannot be queued twice.
 *
 * States: queued → running → complete | failed | cancelled
 *
 * Edge cases handled:
 * - Stale jobs (running > 5min) → auto-failed
 * - Failed jobs → auto-retry once after 30s
 * - Completed jobs → evicted after 5min
 * - Duplicate protocolId → rejected
 * - Server restart → queue lost (v1, acceptable)
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { ProtocolRunnerService, RunResult } from './protocol-runner.service';
import { PrismaService } from '../../database/prisma.service';

// ── Types ──────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface JobProgress {
  done: number;
  total: number;
  currentSymbol?: string;
}

export interface QueueJob {
  id: string; // uuid
  runId: number; // ProtocolRun.id
  name: string;
  protocolId: string;
  symbols: string[];
  status: JobStatus;
  progress: JobProgress;
  result?: RunResult;
  error?: string;
  retryCount: number;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

// ── Constants ──────────────────────────────────────────────

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 30_000;
const STALE_TIMEOUT_MS = 300_000; // 5 min
const EVICT_COMPLETED_AFTER_MS = 300_000; // 5 min
const EVICTION_INTERVAL_MS = 30_000;

// ── Service ────────────────────────────────────────────────

@Injectable()
export class ExecutionQueueService {
  private readonly logger = new Logger(ExecutionQueueService.name);
  private readonly jobs: QueueJob[] = [];
  private processing = false;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly runner: ProtocolRunnerService,
    private readonly prisma: PrismaService,
  ) {
    // Start periodic eviction of stale + old completed jobs
    this.evictionTimer = setInterval(() => this.evict(), EVICTION_INTERVAL_MS);
  }

  // ── Public API ───────────────────────────────────────

  /**
   * Enqueue a ProtocolRun for execution.
   * @returns job ID (uuid)
   */
  async enqueue(runId: number): Promise<string> {
    // Load run config
    if (!this.prisma.isAvailable) {
      throw new Error('Database not available');
    }

    const record = await this.prisma.protocolRun.findUnique({
      where: { id: runId },
    });

    if (!record) {
      throw new Error(`ProtocolRun ${runId} not found`);
    }

    // Prevent duplicate protocol
    const existing = this.jobs.find(
      (j) =>
        j.protocolId === record.protocolId &&
        (j.status === 'queued' || j.status === 'running'),
    );
    if (existing) {
      throw new Error(
        `Protocol "${record.protocolId}" already has job ${existing.id} (${existing.status})`,
      );
    }

    if (!record.symbols || (record.symbols as string[]).length === 0) {
      throw new Error('No symbols in run config');
    }

    const job: QueueJob = {
      id: uuid(),
      runId: record.id,
      name: record.name,
      protocolId: record.protocolId,
      symbols: record.symbols as string[],
      status: 'queued',
      progress: { done: 0, total: (record.symbols as string[]).length },
      retryCount: 0,
      queuedAt: new Date(),
    };

    this.jobs.push(job);
    this.logger.log(`📥 Enqueued job ${job.id} — "${job.name}" (${job.symbols.length} symbols)`);

    // Update ProtocolRun status
    await this.prisma.protocolRun.update({
      where: { id: runId },
      data: { status: 'queued' },
    });

    // Trigger processing
    this.processNext();

    return job.id;
  }

  /** Get a single job by ID. */
  getJob(jobId: string): QueueJob | null {
    return this.jobs.find((j) => j.id === jobId) ?? null;
  }

  /** Get all jobs (queued + running + recently completed). */
  getQueue(): QueueJob[] {
    return [...this.jobs];
  }

  /** Aggregate queue stats. */
  getStats(): QueueStats {
    return {
      queued: this.jobs.filter((j) => j.status === 'queued').length,
      running: this.jobs.filter((j) => j.status === 'running').length,
      completed: this.jobs.filter((j) => j.status === 'complete').length,
      failed: this.jobs.filter((j) => j.status === 'failed').length,
      cancelled: this.jobs.filter((j) => j.status === 'cancelled').length,
    };
  }

  /** Cancel a queued job. Cannot cancel a running job. */
  cancel(jobId: string): boolean {
    const job = this.getJob(jobId);
    if (!job) return false;
    if (job.status !== 'queued') return false;

    job.status = 'cancelled';
    job.completedAt = new Date();
    this.logger.log(`🚫 Cancelled job ${jobId}`);

    // Update ProtocolRun
    this.prisma.protocolRun
      .update({ where: { id: job.runId }, data: { status: 'cancelled' } })
      .catch(() => {});

    return true;
  }

  // ── Internal ─────────────────────────────────────────

  /** Process the next queued job (if not already processing). */
  private async processNext(): Promise<void> {
    if (this.processing) return;

    const next = this.jobs.find((j) => j.status === 'queued');
    if (!next) return;

    this.processing = true;
    await this.executeJob(next);
    this.processing = false;

    // Chain to next
    this.processNext();
  }

  /** Execute a single job. */
  private async executeJob(job: QueueJob): Promise<void> {
    job.status = 'running';
    job.startedAt = new Date();
    this.logger.log(`▶ Running job ${job.id} — "${job.name}"`);

    // Update ProtocolRun
    await this.prisma.protocolRun.update({
      where: { id: job.runId },
      data: { status: 'running', lastRunAt: new Date() },
    });

    try {
      const result = await this.runner.executeRun({
        name: job.name,
        protocolId: job.protocolId,
        symbols: job.symbols,
      });

      job.status = 'complete';
      job.result = result;
      job.progress = { done: job.symbols.length, total: job.symbols.length };
      job.completedAt = new Date();

      this.logger.log(`✓ Job ${job.id} complete: ${result.durationMs}ms, ${result.results.length} symbols`);

      // Update ProtocolRun
      await this.prisma.protocolRun.update({
        where: { id: job.runId },
        data: {
          status: 'complete',
          results: result.results as any,
          runCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.error(`✗ Job ${job.id} failed: ${err.message}`);

      if (job.retryCount < MAX_RETRIES) {
        job.retryCount++;
        job.status = 'queued';
        job.error = err.message;
        this.logger.log(`🔄 Scheduling retry ${job.retryCount}/${MAX_RETRIES} in ${RETRY_DELAY_MS}ms`);

        setTimeout(() => this.processNext(), RETRY_DELAY_MS);
      } else {
        job.status = 'failed';
        job.error = err.message;
        job.completedAt = new Date();

        await this.prisma.protocolRun.update({
          where: { id: job.runId },
          data: { status: 'failed', errorMessage: err.message },
        });
      }
    }
  }

  /** Periodic eviction of stale and old jobs. */
  private evict(): void {
    const now = Date.now();
    const before = this.jobs.length;

    // Remove completed/cancelled/failed jobs older than 5 min
    // Mark stale running jobs (stuck > 5 min) as failed
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i];
      const age = now - new Date(job.startedAt ?? job.queuedAt).getTime();

      if (job.status === 'running' && age > STALE_TIMEOUT_MS) {
        job.status = 'failed';
        job.error = 'Job timed out (stale after 5 minutes)';
        job.completedAt = new Date();
        this.logger.warn(`⏰ Job ${job.id} marked stale → failed`);
        this.prisma.protocolRun
          .update({
            where: { id: job.runId },
            data: { status: 'failed', errorMessage: job.error },
          })
          .catch(() => {});
      }

      if (
        (job.status === 'complete' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt &&
        now - job.completedAt.getTime() > EVICT_COMPLETED_AFTER_MS
      ) {
        this.jobs.splice(i, 1);
      }
    }

    const removed = before - this.jobs.length;
    if (removed > 0) {
      this.logger.debug(`🧹 Evicted ${removed} old jobs (${this.jobs.length} remaining)`);
    }
  }
}
