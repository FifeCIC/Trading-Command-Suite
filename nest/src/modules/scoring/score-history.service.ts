/**
 * Score History Service
 * =====================
 * Stores and retrieves scoring result snapshots from the Score table.
 *
 * GET /api/scoring/history/:symbolId       → recent snapshots
 * GET /api/scoring/history/:symbolId/latest → most recent snapshot
 *
 * The Score model requires symbolId + strategyId as foreign keys.
 * strategyId is resolved dynamically (find-or-create) in the caller.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ScoreSnapshot {
  id: string;
  symbolId: string;
  strategyId: string;
  value: number;
  breakdown: any;
  timestamp: Date;
}

export interface ScoreHistoryEntry {
  id: string;
  value: number;
  confidence: number;
  mode: string;
  breakdown: any;
  timestamp: Date;
}

@Injectable()
export class ScoreHistoryService {
  private readonly logger = new Logger(ScoreHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a scoring snapshot to the Score table.
   * Caller must supply a valid strategyId (resolved from the DB).
   */
  async storeSnapshot(
    symbolId: string,
    strategyId: string,
    value: number,
    breakdown: any,
  ): Promise<ScoreSnapshot> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — skipping score snapshot');
      return null as unknown as ScoreSnapshot;
    }

    const record = await this.prisma.score.create({
      data: {
        symbolId,
        strategyId,
        value,
        breakdown,
      },
    });

    this.logger.debug(
      `Stored score snapshot: symbolId=${symbolId} value=${value.toFixed(1)}`,
    );

    return {
      id: record.id,
      symbolId: record.symbolId,
      strategyId: record.strategyId,
      value: record.value,
      breakdown: record.breakdown,
      timestamp: record.timestamp,
    };
  }

  /**
   * Return the most recent score snapshots for a symbol.
   */
  async getHistory(
    symbolId: string,
    limit = 20,
  ): Promise<ScoreHistoryEntry[]> {
    if (!this.prisma.isAvailable) {
      return [];
    }

    const rows = await this.prisma.score.findMany({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      value: r.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: r.breakdown,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Return the single most recent score snapshot for a symbol.
   * Throws NotFoundException if no scores exist.
   */
  async getLatest(symbolId: string): Promise<ScoreHistoryEntry> {
    if (!this.prisma.isAvailable) {
      throw new NotFoundException(
        `Database unavailable — cannot get latest for ${symbolId}`,
      );
    }

    const row = await this.prisma.score.findFirst({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
    });

    if (!row) {
      throw new NotFoundException(
        `No score history found for symbolId=${symbolId}`,
      );
    }

    return {
      id: row.id,
      value: row.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: row.breakdown,
      timestamp: row.timestamp,
    };
  }
}
