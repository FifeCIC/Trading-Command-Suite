/**
 * PositionSyncService — bridges Broker ↔ DB two-way data flow (#470, #446).
 *
 * Broker-agnostic: accepts positions + provider ID from the automation loop
 * on each tick. Works with MT5, Trading212, Binance, Alpaca, etc.
 *
 * On each sync:
 * 1. Upserts into the Position table (idempotent by symbol + provider)
 * 2. Matches positions to Trade records by ticket (broker-specific ID)
 * 3. Detects closed positions (was in DB, no longer in latest fetch) → finalizes Trade
 *
 * This creates the traceability chain:
 *   Scoring Run → Strategy → Trade(scoringStrategyId, brokerTicket) → Broker Position
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Normalised position shape — any broker adapter should map to this. */
export interface BrokerPosition {
  symbol: string;
  brokerTicket: string;    // broker-specific order/position ID (MT5 ticket, T212 orderId, etc.)
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync broker positions → Position + Trade tables.
   * @param provider — broker ID string (e.g. 'mt5', 'trading212', 'binance')
   * @param positions — normalised position array from the broker adapter
   */
  async syncPositions(
    provider: string,
    positions: BrokerPosition[],
  ): Promise<{ synced: number; closed: number }> {
    if (!this.prisma.isAvailable) return { synced: 0, closed: 0 };
    if (!positions.length) {
      this.logger.debug(`No ${provider} positions to sync`);
      return { synced: 0, closed: 0 };
    }

    try {
      // 1. Upsert incoming positions (idempotent by symbol + provider)
      let synced = 0;
      for (const pos of positions) {
        await (this.prisma as any).position.upsert({
          where: { symbol_provider: { symbol: pos.symbol, provider } },
          create: {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            provider,
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

        // 2. Link to Trade record by broker ticket
        if (pos.brokerTicket) {
          await this.prisma.trade.updateMany({
            where: { brokerTicket: pos.brokerTicket, status: 'open' },
            data: {
              sl: pos.sl,
              tp: pos.tp,
              brokerComment: pos.comment?.substring(0, 200),
            },
          }).catch(() => {});
        }
      }

      // 3. Detect closed positions (in DB but not in latest fetch)
      const incomingSymbols = positions.map(p => p.symbol);
      const dbPositions = await (this.prisma as any).position.findMany({ where: { provider } });
      let closed = 0;
      for (const dbPos of dbPositions) {
        if (!incomingSymbols.includes(dbPos.symbol)) {
          await this.prisma.trade.updateMany({
            where: { symbol: dbPos.symbol, provider, status: 'open' },
            data: { exitPrice: dbPos.currentPrice, pnl: dbPos.pnl, status: 'closed', closedAt: new Date() },
          }).catch(() => {});

          await (this.prisma as any).position.delete({ where: { id: dbPos.id } }).catch(() => {});
          closed++;
        }
      }

      this.lastSyncedAt = new Date();
      if (synced > 0 || closed > 0) {
        this.logger.log(`[${provider}] Position sync: ${synced} upserted, ${closed} closed`);
      }
      return { synced, closed };
    } catch (err) {
      this.logger.warn(`[${provider}] Position sync failed: ${(err as Error).message}`);
      return { synced: 0, closed: 0 };
    }
  }

  getLastSyncTime(): Date | null { return this.lastSyncedAt; }
}
