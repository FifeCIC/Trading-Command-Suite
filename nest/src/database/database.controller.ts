/**
 * Database Controller — monitoring endpoints
 * ===========================================
 * Exposes DB health and table statistics for the
 * data pipeline monitoring dashboard.
 */

import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface TableStat {
  tableName: string;
  rowCount: number;
  dataSizeKb: number;
  indexSizeKb: number;
  totalSizeKb: number;
  lastInsert: string | null;
  engine: string | null;
}

@Controller('database')
export class DatabaseController {
  private readonly logger = new Logger(DatabaseController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/database/table-stats — row counts, sizes, and freshness for all tables. */
  @Get('table-stats')
  async tableStats(): Promise<{
    tables: TableStat[];
    summary: {
      totalTables: number;
      totalRows: number;
      totalDataKb: number;
      totalIndexKb: number;
    };
  }> {
    if (!this.prisma.isAvailable) {
      return { tables: [], summary: { totalTables: 0, totalRows: 0, totalDataKb: 0, totalIndexKb: 0 } };
    }

    try {
      // Use SHOW TABLE STATUS which returns row counts and sizes natively
      const rows = await this.prisma.$queryRaw<Array<{
        Name: string;
        Rows: bigint | number;
        Data_length: bigint | number;
        Index_length: bigint | number;
        Update_time: string | null;
        Engine: string | null;
      }>>`SHOW TABLE STATUS FROM \`tradingcs\``;

      const tables: TableStat[] = rows.map((r) => {
        const dataLen = Number(r.Data_length ?? 0);
        const indexLen = Number(r.Index_length ?? 0);
        return {
          tableName: r.Name,
          rowCount: Number(r.Rows ?? 0),
          dataSizeKb: Math.round(dataLen / 1024),
          indexSizeKb: Math.round(indexLen / 1024),
          totalSizeKb: Math.round((dataLen + indexLen) / 1024),
          lastInsert: r.Update_time ?? null,
          engine: r.Engine ?? null,
        };
      });

      return {
        tables,
        summary: {
          totalTables: tables.length,
          totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
          totalDataKb: tables.reduce((s, t) => s + t.dataSizeKb, 0),
          totalIndexKb: tables.reduce((s, t) => s + t.indexSizeKb, 0),
        },
      };
    } catch (err) {
      this.logger.warn(`Table stats query failed: ${(err as Error).message}`);
      return { tables: [], summary: { totalTables: 0, totalRows: 0, totalDataKb: 0, totalIndexKb: 0 } };
    }
  }
}
