/**
 * Scheduler Controller
 * =====================
 * Exposes TradingSchedulerService as a REST API.
 * Start/stop the scheduler, view status, trigger manual runs, view history.
 */

import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TradingSchedulerService } from './trading-scheduler.service';

@ApiTags('scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: TradingSchedulerService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get scheduler status' })
  getStatus() {
    return {
      running: false, // scheduler is cron-based, always 'running' when app is up
      schedule: '0 9 * * 1-5 (Mon-Fri 9am)',
      isFallback: !process.env.DATABASE_URL,
      lastRun: this.schedulerService.getRuns(1)[0] || null,
    };
  }

  @Post('run-now')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force a scheduler run immediately' })
  async runNow() {
    const run = await this.schedulerService.triggerManual();
    return { triggered: true, run };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get scheduler run history' })
  getHistory() {
    return this.schedulerService.getRuns(20);
  }
}
