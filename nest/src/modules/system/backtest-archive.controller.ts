import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { BacktestArchiveService } from './backtest-archive.service';
import type { ArchiveIndex } from './backtest-archive.service';
import { RETENTION_TABLES, RETENTION_DAYS } from './retention.config';

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

  /**
   * exportTable() — the ONLY endpoint that prunes/archives a retention table.
   *
   * ⚠️ THE DEFAULTS COME FROM `retention.config.ts`, NOT FROM LITERALS HERE.
   *
   * This endpoint used to default `dateCol` to `'predictedAt'`. For
   * `directiveoutcome` that is the DERIVED column — written from the evaluated
   * bar's OPEN time — whereas the retention config prunes on `createdAt`, the
   * intrinsic write-time column. So a caller who omitted `dateCol` (the easiest
   * call to make, and the one a script is most likely to make) pruned by the
   * derived column and silently deleted evidence the config was protecting.
   *
   * That is the exact failure `retention.config.ts` exists to prevent, so having
   * a second hardcoded owner of the column here defeated the point of it. There
   * is now ONE owner: the config. Change the prune column there, not here.
   *
   * `predictedAt` remains VALID as an explicit `dateCol` for archiving — reads
   * are not writes, and slicing archived data by prediction date is meaningful.
   * It is only the DEFAULT that must never be the derived column.
   */
  @Post('export')
  async exportTable(
    @Query('table') table: string = 'directiveoutcome',
    @Query('dateCol') dateCol?: string,
    @Query('days') days?: string,
  ) {
    const cfg = RETENTION_TABLES[table];
    const resolvedCol = dateCol || cfg?.dateCol || 'createdAt';
    // `RETENTION_DAYS` is DERIVED from `RETENTION_TABLES` via Object.fromEntries, so it is
    // keyed by TABLE name (not by `envKey`) and cannot drift from the config. `cfg.defaultDays`
    // is the fallback for a table that is not declared at all.
    const resolvedDays = days ? parseInt(days) : (RETENTION_DAYS[table] ?? cfg?.defaultDays ?? 30);
    return this.archive.exportAndPrune(table, resolvedCol, resolvedDays);
  }
}
