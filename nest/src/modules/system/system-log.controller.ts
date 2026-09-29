import { Controller, Get, Post, Query } from '@nestjs/common';
import { SystemLogService, LogEntry } from './log.service';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';

@Controller('system')
export class SystemLogController {
  constructor(
    private readonly logService: SystemLogService,
    private readonly metrics: MetricsMiddleware,
  ) {}

  @Get('logs')
  getLogs(
    @Query('limit') limit?: string,
    @Query('level') level?: string,
  ) {
    const parsed = parseInt(limit || '50', 10);
    const max = Math.min(Math.max(parsed || 50, 1), 500);
    let logs: LogEntry[];
    if (level) {
      logs = this.logService.getRecentByLevel(level as LogEntry['level'], max);
    } else {
      logs = this.logService.getRecent(max);
    }
    return { logs, count: logs.length };
  }

  @Get('logs/file')
  getLogFile(@Query('lines') lines?: string) {
    const parsed = parseInt(lines || '200', 10);
    const content = this.logService.readLogFile(Math.min(Math.max(parsed, 10), 1000));
    return { content, lines: content ? content.split('\n').filter(Boolean).length : 0 };
  }

  @Get('logs/status')
  getLogStatus() {
    return this.logService.getLogFileStatus();
  }

  @Get('logs/files')
  getLogFiles() {
    return { files: this.logService.getLogFiles() };
  }

  @Get('logs/categories')
  getCategories() {
    return { categories: this.logService.categories };
  }

  /**
   * What the log directory holds and what a prune would remove — the DRY RUN.
   *
   * The report lists every file by name and size, so "which files will go?" is answered before
   * anything is deleted rather than after. `kept` names the reason each survivor survived, which is
   * how the today's-file exemption is checkable rather than asserted.
   */
  @Get('logs/retention')
  getRetention() {
    return this.logService.getRetentionReport();
  }

  /**
   * Run the prune. `POST` on purpose — it deletes files, so it must not be reachable by a GET that a
   * browser, a prefetcher or a link-checker can fire. Defaults to a dry run when `dryRun` is absent.
   */
  @Post('logs/prune')
  prune(@Query('dryRun') dryRun?: string) {
    // ⚠️ Absent means DRY RUN, not live. The dangerous value must be the one you typed out.
    const isDryRun = dryRun !== 'false';
    return this.logService.pruneOldLogs({ dryRun: isDryRun });
  }

  /** How much volume the repeat collapse has removed since boot. */
  @Get('logs/collapse-stats')
  getCollapseStats() {
    return this.logService.getCollapseStats();
  }

  @Get('metrics')
  getMetrics() {
    return this.metrics.getMetrics();
  }
}
