/**
 * TradeRecorderService — persists trade executions to the Trade table.
 *
 * Every order that reaches a broker MUST pass through this service.
 * This is the single chokepoint for trade traceability (#446).
 *
 * MT5 traceability fields (ticket, sl, tp, magic, swap, brokerComment):
 * These were added in #446 Phase 2. Previously, the automation loop called
 * bridgePost(), received a ticket number, and discarded it. The Trade record
 * had no link to the broker position — you couldn't reconcile DB trades with
 * MT5 positions. Now every field the bridge returns is stored.
 *
 * The ticket field is how we match a Trade row to an MT5 position:
 *   bridge GET /positions → ticket=152239905341
 *   DB   SELECT * FROM trade WHERE ticket=152239905341
 * Without ticket, there is no traceability.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SystemLogService } from '../system/log.service';

export interface TradeRecord {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  provider: 'trading212' | 'mt5' | 'manual';
  strategy?: string;
  scoringStrategyId?: string;
  status: 'open' | 'closed' | 'rejected';
  origin?: 'user' | 'agent' | 'strategy' | 'system';
  /** Pipeline identifier — which system generated this trade (#525) */
  source?: 'meta-stack' | 'speed-scanner' | 'manual' | 'backtest' | 'directive-direct';
  /** A/B test pairing reference */
  abTestId?: string;
  openedAt?: Date;
  /** MT5 broker fields for traceability */
  ticket?: number;
  sl?: number;
  tp?: number;
  magic?: number;
  swap?: number;
  brokerComment?: string;
}

@Injectable()
export class TradeRecorderService {
  private readonly logger = new Logger(TradeRecorderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syslog: SystemLogService,
  ) {}

  /** Record a new trade or order attempt */
  async record(trade: TradeRecord): Promise<string | null> {
    try {
      const created = await this.prisma.trade.create({
        data: {
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          entryPrice: trade.entryPrice || 0,
          exitPrice: trade.exitPrice,
          pnl: trade.pnl,
          provider: trade.provider,
          strategy: trade.strategy || null,
          scoringStrategyId: trade.scoringStrategyId || null,
          status: trade.status,
          origin: trade.origin || 'user',
          source: trade.source ?? null,
          abTestId: trade.abTestId ?? null,
          openedAt: trade.openedAt || new Date(),
          closedAt: trade.status === 'closed' ? new Date() : null,
          // MT5 traceability (#446)
          ticket: trade.ticket ?? null,
          sl: trade.sl ?? null,
          tp: trade.tp ?? null,
          magic: trade.magic ?? null,
          swap: trade.swap ?? null,
          brokerComment: trade.brokerComment ?? null,
        },
      });

      const pnlStr = trade.pnl != null ? ` PnL=${trade.pnl.toFixed(2)}` : '';
      this.syslog.trade('TradeRecorder', `[${trade.origin || 'user'}] ${trade.provider} ${trade.side} ${trade.quantity}×${trade.symbol} [${trade.status}]${pnlStr} id=${created.id}`);

      return created.id;
    } catch (err) {
      this.logger.error(`Failed to record trade: ${(err as Error).message}`);
      this.syslog.error('TradeRecorder', `Failed to record ${trade.provider} ${trade.side} ${trade.symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Mark a trade as closed (filled sell) */
  async close(id: string, exitPrice: number, pnl: number): Promise<boolean> {
    try {
      await this.prisma.trade.update({
        where: { id },
        data: { exitPrice, pnl, status: 'closed', closedAt: new Date() },
      });
      this.syslog.trade('TradeRecorder', `Trade closed: ${id} exit=${exitPrice} PnL=${pnl.toFixed(2)}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to close trade ${id}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Mark a trade as rejected */
  async reject(id: string, reason: string): Promise<void> {
    try {
      await this.prisma.trade.update({ where: { id }, data: { status: 'rejected' } });
      this.syslog.trade('TradeRecorder', `Trade rejected: ${id} — ${reason}`);
    } catch {}
  }

  /** Fetch trade history */
  async getHistory(params: {
    provider?: string;
    symbol?: string;
    days?: number;
    limit?: number;
    status?: string;
  }) {
    const where: any = {};
    if (params.provider) where.provider = params.provider;
    if (params.symbol) where.symbol = params.symbol;
    if (params.status) where.status = params.status;
    if (params.days) {
      where.openedAt = { gte: new Date(Date.now() - params.days * 24 * 60 * 60 * 1000) };
    }

    const trades = await this.prisma.trade.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      take: params.limit || 200,
    });

    const summary = {
      total: trades.length,
      open: trades.filter(t => t.status === 'open').length,
      closed: trades.filter(t => t.status === 'closed').length,
      rejected: trades.filter(t => t.status === 'rejected').length,
      totalPnl: trades.reduce((s, t) => s + (t.pnl || 0), 0),
    };

    return { trades, summary };
  }
}
