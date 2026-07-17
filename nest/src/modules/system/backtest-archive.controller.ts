import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { BacktestArchiveService } from './backtest-archive.service';
import type { ArchiveIndex } from './backtest-archive.service';

@Controller('system/backtest-archive')
export class BacktestArchiveController {
  constructor(private readonly archive: BacktestArchiveService) {}

  @Get('index')
  getIndex(): ArchiveIndex { return this.archive.getIndex(); }

  @Get('import/:archiveId')
  readArchive(@Param('archiveId') id: string) {
    const data = this.archive.readArchive(id);
    if (!data) return { error: 'Archive not found', archiveId: id };
    return { archiveId: id, rows: data.length, data };
  }

  @Post('export')
  async exportTable(
    @Query('table') table: string = 'directiveoutcome',
    @Query('dateCol') dateCol: string = 'predictedAt',
    @Query('days') days: string = '30',
  ) {
    return this.archive.exportAndPrune(table, dateCol, parseInt(days));
  }
}
