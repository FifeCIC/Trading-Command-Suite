/**
 * PositionSyncService — bridges Broker ↔ DB two-way data flow (#470, #446, #616).
 *
 * Broker-agnostic: accepts positions + provider ID from the automation loop
 * on each tick. Works with MT5, Trading212, Binance, Alpaca, etc.
 *
 * On each sync:
 * 1. Upserts into the Position table (idempotent by symbol + provider),
 *    now storing the 64-bit broker ticket as a STRING (brokerTicket).
 * 2. Matches positions to Trade records by brokerTicket — and CREATES a
 *    Trade row for any broker position we have never seen (externally or
 *    manually opened positions become first-class trades).
 * 3. Detects closed positions (was in DB, no longer in latest fetch) →
 *    finalizes the Trade with the real exit price (from broker deal history)
 *    and emits a configurable notification.
 *
 * This creates the traceability chain:
 *   Scoring Run → Strategy → Trade(scoringStrategyId, brokerTicket) → Broker Position
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { AdapterFactory } from './adapter-factory';

/** Normalised position shape — any broker adapter should map to this. */
export interface BrokerPosition {
  symbol: string;
  brokerTicket: string;    // broker-specific order/position ID (MT5 ticket, T212 orderId, etc.) — 64-bit safe string
  side?: 'buy' | 'sell';
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  sl: number | null;
  tp: number | null;
  comment: string;
  openedAt: Date;
  accountId?: string | null;
}

export interface PositionSyncOptions {
  /** True only when the broker positively returned a complete snapshot. */
  authoritative?: boolean;
  accountId?: string | null;
}

@Injectable()
export class PositionSyncService {
  private readonly logger = new Logger(PositionSyncService.name);
  private lastSyncedAt: Date | null = null;
  private lastResult: { synced: number; created: number; closed: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * Sync broker positions → Position + Trade tables.
   * @param provider — broker ID string (e.g. 'mt5', 'trading212', 'binance')
   * @param positions — normalised position array from the broker adapter
   */
  async syncPositions(
    provider: string,
    positions: BrokerPosition[],
    options: PositionSyncOptions = {},
  ): Promise<{ synced: number; created: number; closed: number }> {
    if (!this.prisma.isAvailable) return { synced: 0, created: 0, closed: 0 };
    const authoritative = options.authoritative ?? positions.length > 0;
    const accountId = options.accountId ?? null;

    try {
      // 1. Upsert incoming positions by broker ticket. Symbol-level uniqueness
      // collapses hedged/pyramided positions and is unsafe across accounts.
      let synced = 0;
      let created = 0;
      for (const pos of positions) {
        const positionAccountId = pos.accountId ?? accountId;
        const data = {
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            provider,
            accountId: positionAccountId,
            brokerTicket: pos.brokerTicket || null,
            side: pos.side || null,
            openedAt: pos.openedAt,
            lastQuotedAt: new Date(),
        };
        const update = {
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.currentPrice,
            pnl: pos.pnl,
            brokerTicket: pos.brokerTicket || null,
            side: pos.side || null,
            accountId: positionAccountId,
            lastQuotedAt: new Date(),
        };
        if (pos.brokerTicket) {
          await (this.prisma as any).position.upsert({
            where: { provider_brokerTicket: { provider, brokerTicket: pos.brokerTicket } },
            create: data,
            update,
          });
        } else {
          const existing = await (this.prisma as any).position.findFirst({
            where: { provider, accountId: positionAccountId, symbol: pos.symbol, brokerTicket: null },
          });
          if (existing) {
            await (this.prisma as any).position.update({ where: { id: existing.id }, data: update });
          } else {
            await (this.prisma as any).position.create({ data });
          }
        }
        synced++;

        // 2. Link to — or CREATE — the Trade record for this position.
        created += await this.reconcileTrade(provider, pos);
      }

      // 3. Detect closed positions only from a complete broker snapshot. Empty
      // arrays caused by outages must never liquidate the local projection.
      if (!authoritative) {
        this.logger.warn(`[${provider}] Non-authoritative position snapshot — closure detection skipped`);
        return { synced, created, closed: 0 };
      }
      const incomingTickets = positions.map(p => p.brokerTicket).filter(Boolean);
      const incomingSymbols = positions.map(p => p.symbol);
      const dbPositions = await (this.prisma as any).position.findMany({
        where: accountId ? { provider, accountId } : { provider },
      });
      let closed = 0;
      for (const dbPos of dbPositions) {
        const stillOpen = dbPos.brokerTicket
          ? incomingTickets.includes(dbPos.brokerTicket)
          : incomingSymbols.includes(dbPos.symbol);
        if (stillOpen) continue;

        closed += await this.finalizeClosedPosition(provider, dbPos);
      }

      this.lastSyncedAt = new Date();
      this.lastResult = { synced, created, closed };
      if (synced > 0 || created > 0 || closed > 0) {
        this.logger.log(`[${provider}] Position sync: ${synced} upserted, ${created} created, ${closed} closed`);
      }
      return { synced, created, closed };
    } catch (err) {
      this.logger.warn(`[${provider}] Position sync failed: ${(err as Error).message}`);
      return { synced: 0, created: 0, closed: 0 };
    }
  }

  /**
   * Link a broker position to its Trade row — creating one if the position
   * was opened outside the app's own order path (manual / another terminal).
   * Returns 1 if a Trade row was newly created, else 0.
   */
  private async reconcileTrade(provider: string, pos: BrokerPosition): Promise<number> {
    const side = pos.side || 'buy';
    const openWhere: any = { provider, status: 'open' };

    // 2a. Exact match by broker ticket (the primary 64-bit-safe link).
    if (pos.brokerTicket) {
      const byTicket: any = await this.prisma.trade
        .findFirst({ where: { ...openWhere, brokerTicket: pos.brokerTicket } })
        .catch(() => null);
      if (byTicket) {
        await this.prisma.trade.update({
          where: { id: byTicket.id },
          data: {
            sl: pos.sl ?? byTicket.sl,
            tp: pos.tp ?? byTicket.tp,
            brokerComment: pos.comment?.substring(0, 200) || byTicket.brokerComment,
          },
        }).catch(() => {});
        return 0;
      }
    }

    // 2b. Fallback — match by symbol+provider+side (legacy rows with no ticket).
    const bySymbol: any = await this.prisma.trade
      .findFirst({ where: { ...openWhere, symbol: pos.symbol, side, brokerTicket: null }, orderBy: { openedAt: 'desc' } })
      .catch(() => null);
    if (bySymbol) {
      await this.prisma.trade.update({
        where: { id: bySymbol.id },
        data: {
          // Backfill the broker ticket we were missing (#616)
          brokerTicket: pos.brokerTicket || bySymbol.brokerTicket,
          sl: pos.sl ?? bySymbol.sl,
          tp: pos.tp ?? bySymbol.tp,
          brokerComment: pos.comment?.substring(0, 200) || bySymbol.brokerComment,
        },
      }).catch(() => {});
      return 0;
    }

    // 2c. No matching trade — this position was opened outside the app.
    //     Record it as a first-class Trade so the journal/timeline see it.
    const created = await (this.prisma as any).trade.create({
      data: {
        symbol: pos.symbol,
        side,
        quantity: pos.quantity,
        entryPrice: pos.avgPrice || 0,
        pnl: 0,
        provider,
        status: 'open',
        origin: 'external',
        source: 'broker-sync',
        brokerTicket: pos.brokerTicket || null,
        sl: pos.sl ?? null,
        tp: pos.tp ?? null,
        brokerComment: pos.comment?.substring(0, 200) || null,
        openedAt: pos.openedAt || new Date(),
      },
    }).catch((err: any) => {
      this.logger.warn(`Failed to create Trade for external ${provider} ${pos.symbol}: ${err?.message}`);
      return null;
    });

    if (created) {
      this.logger.log(`Created Trade for externally-opened ${provider} position ${pos.symbol} (${pos.brokerTicket || 'no ticket'})`);
      this.notifications?.send({
        title: `🆕 Position opened — ${pos.symbol}`,
        body: `${side.toUpperCase()} ${pos.quantity}×${pos.symbol} @ ${pos.avgPrice} opened on ${provider}` +
          (pos.brokerTicket ? ` (ticket ${pos.brokerTicket})` : ''),
        symbol: pos.symbol,
        event: 'position-opened',
        metadata: { provider, brokerTicket: pos.brokerTicket, side, quantity: pos.quantity },
      }).catch(() => {});
      return 1;
    }
    return 0;
  }

  /**
   * A position that was previously synced is no longer in the latest fetch —
   * it was closed (by the bot, by the user in MT5, or elsewhere). Finalize the
   * Trade with the real exit price from broker deal history and notify.
   * Returns 1 if a Trade was finalized, else 0.
   */
  private async finalizeClosedPosition(provider: string, dbPos: any): Promise<number> {
    // Find the open trade — by broker ticket first, then symbol fallback.
    const where: any = { provider, status: 'open' };
    let trade: any = null;
    if (dbPos.brokerTicket) {
      trade = await this.prisma.trade.findFirst({ where: { ...where, brokerTicket: dbPos.brokerTicket } }).catch(() => null);
    }
    if (!trade) {
      trade = await this.prisma.trade
        .findFirst({ where: { ...where, symbol: dbPos.symbol, brokerTicket: null }, orderBy: { openedAt: 'desc' } })
        .catch(() => null);
    }

    // Real exit price from broker deal history (#470). Falls back to the last
    // known currentPrice/pnl snapshot if the broker doesn't expose deals.
    let exitPrice: number | null = dbPos.currentPrice ?? null;
    let realizedPnl: number | null = dbPos.pnl ?? null;
    try {
      const adapter: any = this.adapterFactory?.create(provider);
      if (adapter?.getDeals && dbPos.openedAt) {
        const deals = await adapter.getDeals(new Date(dbPos.openedAt));
        const byPosition = deals.filter((d: any) =>
          dbPos.brokerTicket && d.positionId === dbPos.brokerTicket,
        );
        // Legacy brokers may not expose a position id. Symbol fallback is safe
        // only when it identifies a single lifecycle in the returned history.
        const symbolDeals = deals.filter((d: any) => d.symbol === dbPos.symbol);
        const candidates = byPosition.length > 0
          ? byPosition
          : dbPos.brokerTicket ? [] : symbolDeals;
        const closingSide = dbPos.side === 'sell' ? 'buy' : 'sell';
        const exitDeals = candidates.filter((d: any) => d.side === closingSide);
        if (exitDeals.length > 0) {
          const filledVolume = exitDeals.reduce((sum: number, d: any) => sum + Number(d.volume || 0), 0);
          exitPrice = filledVolume > 0
            ? exitDeals.reduce((sum: number, d: any) => sum + Number(d.price || 0) * Number(d.volume || 0), 0) / filledVolume
            : Number(exitDeals[exitDeals.length - 1].price || 0);
          realizedPnl = exitDeals.reduce((sum: number, d: any) =>
            sum + Number(d.profit || 0) + Number(d.commission || 0) + Number(d.swap || 0) + Number(d.fee || 0), 0);
        }
      }
    } catch (err) {
      this.logger.debug(`Deal-history lookup failed for ${provider} ${dbPos.symbol}: ${(err as Error).message}`);
    }

    if (trade) {
      await this.prisma.trade.update({
        where: { id: trade.id },
        data: {
          status: 'closed',
          exitPrice: exitPrice ?? trade.exitPrice ?? null,
          pnl: realizedPnl ?? trade.pnl ?? null,
          closedAt: new Date(),
        },
      });

      const pnlStr = realizedPnl != null ? ` PnL=${realizedPnl.toFixed(2)}` : '';
      this.logger.log(`[${provider}] Closed trade ${trade.id} (${trade.symbol}) exit=${exitPrice}${pnlStr}`);
      this.notifications?.send({
        title: `🔻 Position closed — ${trade.symbol}`,
        body: `${(trade.side || 'buy').toUpperCase()} ${trade.quantity}×${trade.symbol} closed @ ${exitPrice ?? 'market'}` +
          (realizedPnl != null ? ` (${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)})` : ''),
        symbol: trade.symbol,
        event: 'position-closed',
        metadata: { provider, brokerTicket: dbPos.brokerTicket ?? trade.brokerTicket, pnl: realizedPnl, exitPrice },
      }).catch(() => {});
    }

    await (this.prisma as any).position.delete({ where: { id: dbPos.id } });
    return 1;
  }

  getLastSyncTime(): Date | null { return this.lastSyncedAt; }

  /** Most recent sync outcome (upserted/created/closed) — for status dashboards. */
  getLastSyncResult(): { synced: number; created: number; closed: number } | null {
    return this.lastResult;
  }
}
