import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { BacktestArchiveService } from './backtest-archive.service';
import { Prisma } from '@prisma/client';

/** Table configuration for pruning — each table has its own date column and retention. */
const TABLE_CONFIG: Record<string, { dateCol: string; defaultDays: number; envKey: string; label: string }> = {
  directiveoutcome:     { dateCol: 'predictedAt',  defaultDays: 7,   envKey: 'DATA_RETENTION_DIRECTIVE_DAYS',  label: 'Directive Outcomes' },
  score_snapshot:       { dateCol: 'snappedAt',    defaultDays: 90,  envKey: 'DATA_RETENTION_SNAPSHOT_DAYS',   label: 'Score Snapshots' },
  marketbar:            { dateCol: 'timestamp',    defaultDays: 60,  envKey: 'DATA_RETENTION_BARS_DAYS',       label: 'Market Bars' },
  strategy_evaluation:  { dateCol: 'evaluatedAt',  defaultDays: 90,  envKey: 'DATA_RETENTION_EVAL_DAYS',       label: 'Strategy Evaluations' },
  decision_log:         { dateCol: 'timestamp',    defaultDays: 90,  envKey: 'DATA_RETENTION_DECISION_DAYS',   label: 'Decision Log' },
  automation_event:     { dateCol: 'timestamp',    defaultDays: 60,  envKey: 'DATA_RETENTION_EVENT_DAYS',      label: 'Automation Events' },
  portfolio_snapshot:   { dateCol: 'takenAt',      defaultDays: 365, envKey: 'DATA_RETENTION_PORTFOLIO_DAYS',  label: 'Portfolio Snapshots' },
  order:                { dateCol: 'createdAt',    defaultDays: 365, envKey: 'DATA_RETENTION_ORDER_DAYS',      label: 'Orders' },
};
/**
 * Data retention service — prunes old data to prevent unbounded growth.
 *
 * Triggered via API: POST /api/system/data-retention/prune?table=directiveoutcome&days=30
 * Scheduled: Cron daily at 3 AM prunes all configured tables.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: BacktestArchiveService,
  ) {}

  /** Scheduled daily prune — runs at 3 AM for all tables. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledPruneAll() {
    this.logger.log('Running scheduled data retention pruning...');
    let grandTotal = 0;
    for (const [table, config] of Object.entries(TABLE_CONFIG)) {
      try {
        const result = await this.pruneTable(table);
        if (result.deleted > 0) {
          this.logger.log(`  ${table}: ${result.deleted} rows pruned (${config.label})`);
          grandTotal += result.deleted;
        }
      } catch (err) {
        this.logger.error(`  ${table}: prune failed — ${(err as Error).message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    this.logger.log(`Scheduled prune complete — ${grandTotal} total rows deleted.`);
  }

  /** Prune a specific table — batch DELETE to avoid table locks. */
  async pruneTable(table: string, retentionDays?: number): Promise<{ table: string; deleted: number; cutoff: Date }> {
    const config = TABLE_CONFIG[table];
    if (!config) return { table, deleted: 0, cutoff: new Date() };

    const days = retentionDays ?? parseInt(process.env[config.envKey] || String(config.defaultDays), 10);
    const cutoff = new Date(Date.now() - days * 86400000);
    const batchSize = 5000;
    let totalDeleted = 0;

    try {
      const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

      // ── Archive before pruning (#354) — best-effort, don't block prune ──
      if (table === 'directiveoutcome') {
        this.archive.exportAndPrune(table, config.dateCol, days).catch(() => {});
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await this.prisma.$executeRawUnsafe(
          `DELETE FROM \`${table}\` WHERE \`${config.dateCol}\` < '${cutoffStr}' LIMIT ${batchSize}`
        );
        if (result === 0) break;
        totalDeleted += result;
        await new Promise(r => setTimeout(r, 200));
      }
      if (totalDeleted > 0) {
        this.logger.log(`Pruned ${totalDeleted} rows from ${table} (${config.label}, older than ${days}d).`);
      }
    } catch (err) {
      this.logger.error(`Prune failed for ${table}: ${(err as Error).message}`);
    }

    return { table, deleted: totalDeleted, cutoff };
  }

  /** Prune all configured tables. */
  async pruneAll(): Promise<Array<{ table: string; deleted: number; cutoff: Date; label: string }>> {
    const results: Array<{ table: string; deleted: number; cutoff: Date; label: string }> = [];
    for (const [table, config] of Object.entries(TABLE_CONFIG)) {
      const r = await this.pruneTable(table);
      results.push({ ...r, label: config.label });
      await new Promise(res => setTimeout(res, 300));
    }
    return results;
  }

  /** Get table stats — uses INFORMATION_SCHEMA for fast approximate row counts. */
  async getStats() {
    const stats: Record<string, { count: number; oldest: string | null; newest: string | null; retentionDays: number; label: string; sizeEstimate: string }> = {};

    // Fast approximate row counts from INFORMATION_SCHEMA (instant, even on 10M+ rows)
    let tableRows: Record<string, number> = {};
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; TABLE_ROWS: number }>>(
        `SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
      );
      for (const r of rows) tableRows[r.TABLE_NAME] = Number(r.TABLE_ROWS);
    } catch { /* fallback to zero */ }

    for (const [table, config] of Object.entries(TABLE_CONFIG)) {
      const retentionDays = parseInt(process.env[config.envKey] || String(config.defaultDays), 10);
      const count = tableRows[table] || 0;

      // Date range — uses MIN/MAX which are indexed, still fast
      let oldest: string | null = null;
      let newest: string | null = null;
      try {
        const dateCol = config.dateCol;
        const dateRows = await this.prisma.$queryRawUnsafe<Array<{ first: Date | null; last: Date | null }>>(
          `SELECT MIN(\`${dateCol}\`) as first, MAX(\`${dateCol}\`) as last FROM \`${table}\``,
        );
        oldest = dateRows[0]?.first ? new Date(dateRows[0].first).toISOString() : null;
        newest = dateRows[0]?.last ? new Date(dateRows[0].last).toISOString() : null;
      } catch { /* date range unavailable */ }

      stats[table] = {
        count,
        oldest,
        newest,
        retentionDays,
        label: config.label,
        sizeEstimate: count > 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count > 1_000 ? `${(count / 1_000).toFixed(1)}K` : String(count),
      };
    }
    return stats;
  }
}
