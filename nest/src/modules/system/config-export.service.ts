/**
 * ConfigExportService — exports critical configuration tables as JSON seed files.
 *
 * This replaces the heavy mysqldump approach. Only user-created configuration
 * is exported — provider-fetched data (scores, bars, signals, news) is excluded
 * because it's rebuildable from providers.
 *
 * Export trigger: POST /api/system/config/export
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const SEED_DIR = path.resolve(process.cwd(), 'src', 'data', 'seed');

// Tables to export (user-created config, not provider data)
const EXPORT_TABLES = [
  { table: 'strategy',        file: 'strategies.json',        label: 'Trading Strategies' },
  { table: 'directive',       file: 'directives.json',        label: 'Directives' },
  { table: 'protocol',        file: 'protocols.json',         label: 'Protocols' },
  { table: 'watchlist',       file: 'watchlists.json',        label: 'Watchlists' },
  { table: 'app_setting',     file: 'app-settings.json',      label: 'App Settings' },
  { table: 'user_preferences',file: 'user-preferences.json',  label: 'User Preferences' },
  { table: 'automation_config',  file: 'automation-config.json',  label: 'Automation Config' },
  { table: 'automation_rule',    file: 'automation-rules.json',   label: 'Automation Rules' },
  { table: 'symbol',          file: 'symbols.json',           label: 'Symbols (name, ticker, exchange)' },
];

@Injectable()
export class ConfigExportService {
  private readonly logger = new Logger(ConfigExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Export all config tables to JSON seed files. Returns summary. */
  async exportAll(): Promise<{ files: Array<{ file: string; count: number; bytes: number }>; totalBytes: number }> {
    if (!this.prisma.isAvailable) throw new Error('Database not available');

    if (!fs.existsSync(SEED_DIR)) fs.mkdirSync(SEED_DIR, { recursive: true });

    const results: Array<{ file: string; count: number; bytes: number }> = [];
    let totalBytes = 0;

    for (const { table, file, label } of EXPORT_TABLES) {
      try {
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM \`${table}\``);
        const json = JSON.stringify(rows, null, 2);
        const filePath = path.join(SEED_DIR, file);
        fs.writeFileSync(filePath, json, 'utf-8');
        const bytes = Buffer.byteLength(json, 'utf-8');
        totalBytes += bytes;
        results.push({ file, count: rows.length, bytes });
        this.logger.log(`Exported ${label}: ${rows.length} rows → ${file} (${(bytes / 1024).toFixed(1)}KB)`);
      } catch (err) {
        this.logger.error(`Failed to export ${label}: ${(err as Error).message}`);
        results.push({ file, count: 0, bytes: 0 });
      }
    }

    // Write manifest
    const manifest = {
      exportedAt: new Date().toISOString(),
      tables: results,
      totalBytes,
    };
    fs.writeFileSync(path.join(SEED_DIR, 'seed-manifest.json'), JSON.stringify(manifest, null, 2));

    return { files: results, totalBytes };
  }

  /** Get current table sizes for display */
  async getTableStats(): Promise<Array<{ table: string; label: string; rows: number; isConfig: boolean }>> {
    if (!this.prisma.isAvailable) return [];

    const stats: Array<{ table: string; label: string; rows: number; isConfig: boolean }> = [];
    const configTables = new Set(EXPORT_TABLES.map(t => t.table));

    // Config tables
    for (const { table, label } of EXPORT_TABLES) {
      try {
        const r = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
        stats.push({ table, label, rows: Number(r[0]?.cnt ?? 0), isConfig: true });
      } catch { stats.push({ table, label, rows: -1, isConfig: true }); }
    }

    // Data tables (for comparison — not backed up)
    const dataTables = [
      { table: 'score', label: 'Scores (not backed up)' },
      { table: 'market_bar', label: 'Market Bars (not backed up)' },
      { table: 'signal', label: 'Signals (not backed up)' },
      { table: 'earnings_event', label: 'Earnings Events (not backed up)' },
    ];
    for (const { table, label } of dataTables) {
      try {
        const r = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
        stats.push({ table, label, rows: Number(r[0]?.cnt ?? 0), isConfig: false });
      } catch { stats.push({ table, label, rows: -1, isConfig: false }); }
    }

    return stats;
  }
}
