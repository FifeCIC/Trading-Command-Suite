import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Data retention service — prunes old scoring data to prevent unbounded growth.
 *
 * Triggered via API: POST /api/system/data-retention/prune-directives?days=30
 * Configurable via env: DATA_RETENTION_DIRECTIVE_DAYS=30
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);
  private readonly directiveRetentionDays: number;

  constructor(private readonly prisma: PrismaService) {
    this.directiveRetentionDays = parseInt(process.env.DATA_RETENTION_DIRECTIVE_DAYS || '30', 10);
  }

  /** Prune old directive outcome rows in batches to avoid table locks. */
  async pruneDirectiveOutcomes(retentionDays?: number) {
    const days = retentionDays ?? this.directiveRetentionDays;
    const cutoff = new Date(Date.now() - days * 86400000);
    const batchSize = 5000;
    let totalDeleted = 0;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await this.prisma.$executeRawUnsafe(
          `DELETE FROM directiveoutcome WHERE createdAt < ? LIMIT ?`,
          cutoff, batchSize,
        );
        if (result === 0) break;
        totalDeleted += result;
        this.logger.debug(`Pruned ${result} directive outcomes (total: ${totalDeleted})`);
        // Small delay between batches
        await new Promise(r => setTimeout(r, 200));
      }
      if (totalDeleted > 0) {
        this.logger.log(`Pruned ${totalDeleted} directive outcomes older than ${days} days.`);
      } else {
        this.logger.debug('No directive outcomes to prune.');
      }
    } catch (err) {
      this.logger.error(`Directive outcome pruning failed: ${(err as Error).message}`);
    }

    return { deleted: totalDeleted, cutoff };
  }

  /** Get table stats for monitoring */
  async getStats() {
    const tables = ['directiveoutcome', 'score_snapshot', 'marketbar', 'strategy_evaluation', 'decision_log', 'order'];
    const stats: Record<string, { count: number; oldest: string | null; newest: string | null }> = {};

    for (const table of tables) {
      try {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number; first: Date | null; last: Date | null }>>(
          `SELECT COUNT(*) as cnt, MIN(createdAt) as first, MAX(createdAt) as last FROM \`${table}\``,
        );
        stats[table] = {
          count: Number(rows[0]?.cnt ?? 0),
          oldest: rows[0]?.first ? new Date(rows[0].first).toISOString() : null,
          newest: rows[0]?.last ? new Date(rows[0].last).toISOString() : null,
        };
      } catch {
        stats[table] = { count: 0, oldest: null, newest: null };
      }
    }

    return stats;
  }
}
