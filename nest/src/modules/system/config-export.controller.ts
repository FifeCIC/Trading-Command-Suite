/**
 * ConfigExportController — triggers JSON config export and reports table stats.
 *
 * POST /api/system/config/export  — export all config tables as JSON seed files
 * GET  /api/system/config/stats   — table row counts with backup status
 */

import { Controller, Get, Post, Logger } from '@nestjs/common';
import { ConfigExportService } from './config-export.service';

@Controller('system/config')
export class ConfigExportController {
  private readonly logger = new Logger(ConfigExportController.name);

  constructor(private readonly exportService: ConfigExportService) {}

  @Get('stats')
  async getStats() {
    return this.exportService.getTableStats();
  }

  @Post('export')
  async exportAll() {
    return this.exportService.exportAll();
  }
}
