import { Controller, Get, Post, Query } from '@nestjs/common';
import { DataRetentionService } from './data-retention.service';

@Controller('system/data-retention')
export class DataRetentionController {
  constructor(private readonly retention: DataRetentionService) {}

  /** GET /api/system/data-retention/stats — row counts + date ranges for all managed tables */
  @Get('stats')
  getStats() {
    return this.retention.getStats();
  }

  /** POST /api/system/data-retention/prune?table=directiveoutcome&days=30 — prune a single table */
  @Post('prune')
  async pruneTable(@Query('table') table?: string, @Query('days') days?: string) {
    if (!table) return { error: 'table query parameter required' };
    return this.retention.pruneTable(table, days ? parseInt(days) : undefined);
  }

  /** POST /api/system/data-retention/prune-all — prune all configured tables */
  @Post('prune-all')
  async pruneAll() {
    return this.retention.pruneAll();
  }

  /** POST /api/system/data-retention/throttle-scores — cap scores per (symbol, strategy) to N each */
  @Post('throttle-scores')
  async throttleScores(@Query('keep') keep?: string) {
    const deleted = await this.retention.throttleScores(keep ? parseInt(keep) : 100);
    return { deleted, keepPerGroup: keep ? parseInt(keep) : 100 };
  }
}
