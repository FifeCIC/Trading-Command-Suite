import { Controller, Get, Query } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';

/**
 * Job Queue inspection API (#614) — read-only visibility into the DB-driven
 * queue the automation loop polls each tick.
 *
 * GET /api/automation/jobs        — recent jobs (optional ?status= filter)
 * GET /api/automation/jobs/stats  — counts by status + next due job
 */
@Controller('automation/jobs')
export class JobQueueController {
  constructor(private readonly jobQueue: JobQueueService) {}

  @Get()
  getJobs(@Query('limit') limit?: string, @Query('status') status?: string) {
    return this.jobQueue.getJobs(limit ? parseInt(limit, 10) : 50, status);
  }

  @Get('stats')
  getStats() {
    return this.jobQueue.getStats();
  }
}
