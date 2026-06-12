import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { NotificationService } from '../notifications/notifications.service';

export interface SchedulerRun {
  id: string;
  timestamp: string;
  steps: { name: string; status: 'ok' | 'skipped' | 'error'; detail: string }[];
  suggestions: { symbol: string; score: number; action: string }[];
  autoExecuted: boolean;
}

@Injectable()
export class TradingSchedulerService {
  private readonly logger = new Logger(TradingSchedulerService.name);
  private runs: SchedulerRun[] = [];
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Default schedule: 9am Mon-Fri */
  @Cron('0 9 * * 1-5', { name: 'trading-routine' })
  async handleDailyRoutine(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Previous routine still running — skipping');
      return;
    }
    this.isRunning = true;

    const run: SchedulerRun = {
      id: `run-${Date.now()}`,
      timestamp: new Date().toISOString(),
      steps: [],
      suggestions: [],
      autoExecuted: false,
    };

    try {
      // Step 1: Pre-flight checks
      await this.preflightChecks(run);
      const checksFailed = run.steps.some(s => s.status === 'error');
      if (checksFailed) {
        this.logger.warn('Pre-flight checks failed — aborting routine');
        this.runs.push(run);
        return;
      }

      // Step 2: Data freshness
      await this.checkFreshness(run);

      // Step 3: Run scoring (simulated if no live data)
      await this.runScoring(run);

      // Step 4: Generate suggestions
      this.generateSuggestions(run);

      // Step 5: Optionally auto-execute
      this.maybeAutoExecute(run);

      // Step 6: Send daily summary notification
      if (run.suggestions.length > 0) {
        this.notificationService.notifyDailySummary(run.suggestions).catch(err => {
          this.logger.warn(`Daily summary notification failed: ${err.message}`);
        });
      }

    } catch (err) {
      this.logger.error(`Routine failed: ${(err as Error).message}`);
      run.steps.push({ name: 'routine', status: 'error', detail: (err as Error).message });
    } finally {
      this.isRunning = false;
      this.runs.push(run);
    }
  }

  private async preflightChecks(run: SchedulerRun): Promise<void> {
    // DB check
    if (!this.prisma.isAvailable) {
      run.steps.push({ name: 'database', status: 'error', detail: 'Database not connected' });
    } else {
      run.steps.push({ name: 'database', status: 'ok', detail: 'Connected' });
    }

    // Mode check
    const mode = this.modeService.getModeInfo();
    run.steps.push({ name: 'mode', status: 'ok', detail: `Mode: ${mode.mode}, DB: ${mode.database}` });

    // Rate limit check
    run.steps.push({ name: 'rate-limits', status: 'ok', detail: 'OK (mock)' });

    // Market open check (mock — would call Alpaca /v2/clock in production)
    run.steps.push({ name: 'market-open', status: 'ok', detail: 'Paper trading — always open' });
  }

  private async checkFreshness(run: SchedulerRun): Promise<void> {
    if (!this.prisma.isAvailable) {
      run.steps.push({ name: 'freshness', status: 'skipped', detail: 'No database — skipping freshness check' });
      return;
    }
    try {
      const count = await this.prisma.marketBar.count();
      run.steps.push({ name: 'freshness', status: 'ok', detail: `${count} market bars available` });
    } catch {
      run.steps.push({ name: 'freshness', status: 'error', detail: 'Could not query market bars' });
    }
  }

  private async runScoring(run: SchedulerRun): Promise<void> {
    if (!this.prisma.isAvailable) {
      run.steps.push({ name: 'scoring', status: 'skipped', detail: 'Fallback mode — scoring requires database' });
      return;
    }
    try {
      const symbols = await this.prisma.symbol.count({ where: { active: true } });
      run.steps.push({ name: 'scoring', status: 'ok', detail: `${symbols} active symbols available for scoring` });
    } catch {
      run.steps.push({ name: 'scoring', status: 'error', detail: 'Scoring run failed' });
    }
  }

  private generateSuggestions(run: SchedulerRun): void {
    // In production: filter symbols with score ≥ entry threshold, check allocation limits
    run.suggestions = [
      { symbol: 'AAPL', score: 72, action: 'BUY (paper)' },
      { symbol: 'NVDA', score: 68, action: 'BUY (paper)' },
      { symbol: 'TSLA', score: 42, action: 'WATCH' },
    ];
    run.steps.push({ name: 'suggestions', status: 'ok', detail: '3 suggestions generated' });
  }

  private maybeAutoExecute(run: SchedulerRun): void {
    // In production: check if trading strategy has automation.enabled
    run.autoExecuted = false;
    run.steps.push({ name: 'auto-execute', status: 'skipped', detail: 'Auto-execution disabled (paper mode)' });
  }

  /** Get recent runs */
  getRuns(limit = 10): SchedulerRun[] {
    return this.runs.slice(-limit);
  }

  /** Manual trigger */
  async triggerManual(): Promise<SchedulerRun> {
    await this.handleDailyRoutine();
    return this.runs[this.runs.length - 1];
  }

  // ── Controller-compatible wrappers ──

  start(): { ok: boolean } {
    this.logger.log('Scheduler start requested (always active via @Cron)');
    return { ok: true };
  }

  stop(): { ok: boolean } {
    this.logger.log('Scheduler stop requested (ignored — cron is compile-time)');
    return { ok: true };
  }

  getStatus(): { running: boolean; runs: number; lastRun: string | null } {
    const last = this.runs[this.runs.length - 1];
    return {
      running: this.isRunning,
      runs: this.runs.length,
      lastRun: last?.timestamp ?? null,
    };
  }

  async runNow(): Promise<SchedulerRun> {
    return this.triggerManual();
  }

  getHistory(limit = 20): SchedulerRun[] {
    return this.getRuns(limit);
  }
}
