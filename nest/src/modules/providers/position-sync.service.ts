/**
 * PositionSyncService — bridges MT5 ↔ DB two-way data flow (#470, #446).
 *
 * On each automation tick:
 * 1. Fetches live MT5 positions from the bridge
 * 2. Upserts into the Position table (idempotent by symbol + provider)
 * 3. Matches positions to Trade records by ticket
 * 4. Detects closed positions (was in DB, no longer in bridge) → finalizes Trade
 *
 * This creates the traceability chain:
 *   Scoring Run → Strategy → Trade(scoringStrategyId, ticket) → MT5 Position
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Mt5Adapter } from './adapters/mt5.adapter';

export interface SyncedPosition {
  symbol: string;
  ticket: number;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  sl: number | null;
  tp: number | null;
  comment: string;
  openedAt: Date;
}

@Injectable()
export class PositionSyncService {
  private readonly logger = new Logger(PositionSyncService.name);
  private lastSyncedAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5Adapter,
  ) {}

  /**
   * Sync MT5 positions → Position table. Returns count of synced positions.
   * Call from automation loop tick().
   */
  async syncPositions(): Promise<{ synced: number; closed: number }> {
    if (!this.prisma.isAvailable) return { synced: 0, closed: 0 };

    try {
      // 1. Fetch live positions from MT5 bridge
      const livePositions = await this.mt5.getPositions();
      if (!livePositions.length) {
        this.logger.debug('No MT5 positions returned — bridge may be disconnected');
        return { synced: 0, closed: 0 };
      }

      // 2. Map bridge response to our SyncedPosition shape
      const incoming: SyncedPosition[] = livePositions.map(p => ({
        symbol: p.symbol,
        ticket: (p as any).ticket ?? 0,
        quantity: p.quantity,
        avgPrice: p.avgCost,
        currentPrice: p.currentPrice ?? p.avgCost,
        pnl: p.unrealizedPnl ?? 0,
        sl: (p as any).sl ?? null,
        tp: (p as any).tp ?? null,
        comment: (p as any).comment ?? '',
        openedAt: p.openedAt ? new Date(p.openedAt) : new Date(),
      }));

      // 3. Upsert incoming positions
      let synced = 0;
      for (const pos of incoming) {
        await (this.prisma as any).position.upsert({
          where: { symbol_provider: { symbol: pos.symbol, provider: 'mt5' } },
          create: {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            provider: 'mt5',
            openedAt: pos.openedAt,
            lastQuotedAt: new Date(),
          },
          update: {
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            lastQuotedAt: new Date(),
          },
        });
        synced++;

        // 4. Link to Trade record by ticket
        if (pos.ticket > 0) {
          await this.prisma.trade.updateMany({
            where: { ticket: pos.ticket, status: 'open' },
            data: {
              sl: pos.sl,
              tp: pos.tp,
              brokerComment: pos.comment?.substring(0, 200),
            },
          }).catch(() => {}); // ticket may not have a Trade record yet
        }
      }

      // 5. Detect closed positions — were in DB but not in bridge
      const incomingSymbols = incoming.map(p => p.symbol);
      const dbPositions = await (this.prisma as any).position.findMany({
        where: { provider: 'mt5' },
      });
      let closed = 0;
      for (const dbPos of dbPositions) {
        if (!incomingSymbols.includes(dbPos.symbol)) {
          // Position was closed — finalize Trade record
          await this.prisma.trade.updateMany({
            where: { symbol: dbPos.symbol, provider: 'mt5', status: 'open' },
            data: {
              exitPrice: dbPos.currentPrice,
              pnl: dbPos.pnl,
              status: 'closed',
              closedAt: new Date(),
            },
          }).catch(() => {});

          // Delete stale position from DB
          await (this.prisma as any).position.delete({
            where: { id: dbPos.id },
          }).catch(() => {});
          closed++;
        }
      }

      this.lastSyncedAt = new Date();
      if (synced > 0 || closed > 0) {
        this.logger.log(`Position sync: ${synced} upserted, ${closed} closed`);
      }
      return { synced, closed };
    } catch (err) {
      this.logger.warn(`Position sync failed: ${(err as Error).message}`);
      return { synced: 0, closed: 0 };
    }
  }

  /** When was the last successful sync? */
  getLastSyncTime(): Date | null {
    return this.lastSyncedAt;
  }
}
