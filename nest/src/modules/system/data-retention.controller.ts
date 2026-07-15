import { Controller, Get, Post, Query } from '@nestjs/common';
import { DataRetentionService } from './data-retention.service';

@Controller('system/data-retention')
export class DataRetentionController {
  constructor(private readonly retention: DataRetentionService) {}

  @Get('stats')
  getStats() {
    return this.retention.getStats();
  }

  @Post('prune-directives')
  async pruneDirectives(@Query('days') days?: string) {
    const result = await this.retention.pruneDirectiveOutcomes(days ? parseInt(days) : undefined);
    return { pruned: true, ...result };
  }
}
