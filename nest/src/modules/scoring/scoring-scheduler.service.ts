/**
 * Scoring Scheduler Service
 * ==========================
 * Background scoring job that automatically re-scores active symbols
 * on a configurable interval using a setTimeout-based loop.
 *
 * Controlled by two env vars:
 *   SCORING_AUTO_RUN   (default: false) — enables the scheduler
 *   SCORING_INTERVAL_MS (default: 300000 = 5 min) — interval between runs
 *
 * The scheduler only fires when queue mode is enabled (QUEUE_MODE=local).
 * It skips if a run is already in progress and never crashes the process.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModeService } from '../../config/mode.service';
import { ScoringService } from './scoring.service';

@Injectable()
export class ScoringSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ScoringSchedulerService.name);
  private isRunning = false;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private currentIntervalMs: number | null = null;
  private nextRunTime: number | null = null;
  private lastRunResult: { symbolsScored: number; durationMs: number; completedAt: string } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modeService: ModeService,
    private readonly scoringService: ScoringService,
  ) {}

  onModuleInit(): void {
    const autoRun = this.configService.get<string>('SCORING_AUTO_RUN', 'false');
    if (autoRun !== 'true') {
      this.logger.log('SCORING_AUTO_RUN is disabled — scheduler not started');
      return;
    }

    const modeInfo = this.modeService.getModeInfo();
    if (!modeInfo.queue) {
      this.logger.warn(
        'Queue mode is not enabled (QUEUE_MODE != local). Scoring scheduler requires queue mode. Scheduler not started.',
      );
      return;
    }

    const intervalMs = Number(
      this.configService.get<string>('SCORING_INTERVAL_MS', '300000'),
    );
    const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 10_000
      ? intervalMs
      : 300_000;

    this.logger.log(
      `Scoring scheduler enabled — running every ${(safeInterval / 1000).toFixed(0)}s`,
    );

    this.scheduleNext(safeInterval);
  }

  /**
   * Schedule one scoring run after `delayMs`, then chain the next.
   * Uses setTimeout recursively so intervals don't drift and errors
   * in one run don't prevent subsequent runs.
   */
  private scheduleNext(delayMs: number): void {
    this.currentIntervalMs = delayMs;
    this.nextRunTime = Date.now() + delayMs;
    this.timerHandle = setTimeout(async () => {
      await this.executeRun();
      this.scheduleNext(delayMs);
    }, delayMs);

    // Allow the Node.js process to exit even if the timer is still pending
    if (this.timerHandle && typeof this.timerHandle === 'object' && 'unref' in this.timerHandle) {
      this.timerHandle.unref();
    }
  }

  /**
   * Execute a single scoring run. Safe to call multiple times concurrently
   * — the `isRunning` flag prevents overlap.
   */
  async executeRun(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Scoring run skipped — previous run still in progress');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const startIso = new Date().toISOString();

    try {
      this.logger.log(`Scoring run started at ${startIso}`);

      const result = await this.scoringService.rankAll(undefined, 100);
      const symbolCount = result.ranked?.length ?? 0;

      const elapsed = Date.now() - startTime;
      this.lastRunResult = { symbolsScored: symbolCount, durationMs: elapsed, completedAt: new Date().toISOString() };
      this.logger.log(
        `Scoring run completed — ${symbolCount} symbols scored in ${elapsed}ms`,
      );
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.lastRunResult = null;
      this.logger.error(
        `Scoring run failed after ${elapsed}ms: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /** Public status for the Protocols API */
  getStatus(): {
    enabled: boolean;
    intervalMs: number | null;
    nextRunIn: number | null;
    isRunning: boolean;
    lastRun: { symbolsScored: number; durationMs: number; completedAt: string } | null;
  } {
    const nextRunIn = this.nextRunTime ? Math.max(0, this.nextRunTime - Date.now()) : null;
    return {
      enabled: this.currentIntervalMs !== null,
      intervalMs: this.currentIntervalMs,
      nextRunIn,
      isRunning: this.isRunning,
      lastRun: this.lastRunResult,
    };
  }
}
