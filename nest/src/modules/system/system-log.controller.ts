import { Controller, Get, Query } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';

@Controller('system')
export class SystemLogController {
  constructor(
    private readonly logService: SystemLogService,
    private readonly metrics: MetricsMiddleware,
  ) {}

  @Get('logs')
  getLogs(@Query('limit') limit?: string) {
    const parsed = parseInt(limit || '50', 10);
    const max = Math.min(Math.max(parsed || 50, 1), 200);
    return { logs: this.logService.getRecent(max) };
  }

  @Get('metrics')
  getMetrics() {
    return this.metrics.getMetrics();
  }
}
