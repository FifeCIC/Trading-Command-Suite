import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { NotificationService } from '../notifications/notifications.service';
import { ScoringService } from '../scoring/scoring.service';
import { AutomationLoopService } from '../automation/automation-loop.service';

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
    private readonly scoringService: ScoringService,
    private readonly automationLoop: AutomationLoopService,
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
      const activeSymbols = await this.prisma.symbol.findMany({ where: { active: true }, select: { id: true, ticker: true } });
      if (activeSymbols.length === 0) {
        run.steps.push({ name: 'scoring', status: 'skipped', detail: 'No active symbols' });
        return;
      }
      const result = await this.scoringService.rankAll();
      const scored = result?.ranked?.length || 0;
      run.steps.push({ name: 'scoring', status: 'ok', detail: `${scored} symbols scored (${activeSymbols.length} active)` });
    } catch (err) {
      run.steps.push({ name: 'scoring', status: 'error', detail: (err as Error).message });
    }
  }

  private async generateSuggestions(run: SchedulerRun): Promise<void> {
    try {
      const result = await this.scoringService.rankAll(undefined, 10);
      const ranked = (result as any)?.ranked || [];
      if (!ranked.length) {
        run.steps.push({ name: 'suggestions', status: 'ok', detail: 'No ranked symbols available' });
        return;
      }
      run.suggestions = ranked.slice(0, 5).map((r: any) => ({
        symbol: r.ticker || r.symbol || '?',
        score: Math.round(r.score || r.composite || 0),
        action: (r.signal === 'buy' || r.signal === 'BUY' || r.score >= 65) ? 'BUY (paper)' :
                (r.score >= 40) ? 'WATCH' : 'HOLD',
      }));
      run.steps.push({ name: 'suggestions', status: 'ok', detail: `${run.suggestions.length} suggestions from live scoring` });
    } catch (err) {
      run.steps.push({ name: 'suggestions', status: 'error', detail: (err as Error).message });
    }
  }

  private async maybeAutoExecute(run: SchedulerRun): Promise<void> {
    // Safety: only auto-execute if automation loop is running and has scoring strategies
    const hasAutoStrategies = this.automationLoop.scoringStrategies.some(
      s => s.enabled && s.tradingEnabled && s.mode === 'auto'
    );
    if (!hasAutoStrategies) {
      run.autoExecuted = false;
      run.steps.push({ name: 'auto-execute', status: 'skipped', detail: 'No auto-trade strategies enabled — paper-safe mode' });
      return;
    }
    try {
      const decisions = await this.automationLoop.tick();
      const executed = decisions.filter(d => d.decision === 'EXECUTED');
      run.autoExecuted = executed.length > 0;
      run.steps.push({
        name: 'auto-execute',
        status: 'ok',
        detail: `${executed.length} trades executed, ${decisions.length} evaluated`,
      });
    } catch (err) {
      run.autoExecuted = false;
      run.steps.push({ name: 'auto-execute', status: 'error', detail: (err as Error).message });
    }
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
