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
// Table names must match the actual MySQL table names (Prisma @@map or default lowercase).
const EXPORT_TABLES = [
  { table: 'strategy',            file: 'strategies.json',          label: 'Trading Strategies' },
  { table: 'directive',           file: 'directives.json',          label: 'Directives' },
  { table: 'protocol',            file: 'protocols.json',           label: 'Protocols' },
  { table: 'watchlist',           file: 'watchlists.json',          label: 'Watchlists' },
  { table: 'scoring_strategy',    file: 'scoring-strategies.json',  label: 'Scoring Strategies' },
  { table: 'trading_strategy',    file: 'trading-strategies.json',  label: 'Trading Strategies (SEES)' },
  { table: 'tradingplan',         file: 'trading-plans.json',       label: 'Trading Plans' },
  { table: 'planstep',            file: 'plan-steps.json',          label: 'Plan Steps' },
  { table: 'broker_config',       file: 'broker-config.json',       label: 'Broker Config' },
  { table: 'appsetting',          file: 'app-settings.json',        label: 'App Settings' },
  { table: 'userpreferences',     file: 'user-preferences.json',    label: 'User Preferences' },
  { table: 'global_setting',      file: 'global-settings.json',     label: 'Global Settings' },
  { table: 'automationconfig',    file: 'automation-config.json',   label: 'Automation Config' },
  { table: 'automationrule',      file: 'automation-rules.json',    label: 'Automation Rules' },
  { table: 'trading_objective',   file: 'trading-objectives.json',  label: 'Trading Objectives' },
  { table: 'trading_style_preference', file: 'trading-styles.json', label: 'Trading Style Preferences' },
  { table: 'fund_allocation',     file: 'fund-allocations.json',    label: 'Fund Allocations' },
  { table: 'symbolcalibration',   file: 'symbol-calibrations.json', label: 'Symbol Calibrations' },
  { table: 'symbol',              file: 'symbols.json',             label: 'Symbols' },
  { table: 'featureflag',         file: 'feature-flags.json',       label: 'Feature Flags' },
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

    // Data tables (for comparison — not backed up, rebuildable from providers)
    const dataTables = [
      { table: 'score', label: 'Scores' },
      { table: 'marketbar', label: 'Market Bars' },
      { table: 'signal', label: 'Signals' },
      { table: 'earnings_event', label: 'Earnings Events' },
      { table: 'decision_log', label: 'Decision Log' },
      { table: 'decision_trail', label: 'Decision Trail' },
      { table: 'trade', label: 'Trades' },
      { table: 'order', label: 'Orders' },
      { table: 'position', label: 'Positions' },
      { table: 'alert', label: 'Alerts' },
      { table: 'backtestrun', label: 'Backtest Runs' },
      { table: 'directiveoutcome', label: 'Directive Outcomes' },
      { table: 'marketsnapshot', label: 'Market Snapshots' },
      { table: 'portfolio_snapshot', label: 'Portfolio Snapshots' },
      { table: 'automation_event', label: 'Automation Events' },
      { table: 'apiactivitylog', label: 'API Activity Log' },
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
