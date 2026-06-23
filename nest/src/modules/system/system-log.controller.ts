import { Controller, Get, Query } from '@nestjs/common';
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

  @Get('metrics')
  getMetrics() {
    return this.metrics.getMetrics();
  }
}
