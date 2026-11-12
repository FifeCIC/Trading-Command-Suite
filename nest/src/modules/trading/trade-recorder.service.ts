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
  /**
   * Which side of that A/B test: `'A'` (control) or `'B'` (variant) — #929.
   *
   * ⚠️ STRUCTURAL, not derived from `brokerComment`. The comment is overwritten by the
   * stranded-trade reaper, which silently removed reaped A/B trades from the verdict.
   */
  abTestSide?: 'A' | 'B';
  /**
   * ── WHICH LEG OF A PAIRED BOT (#1185, 2026-11-02) ─────────────────────────────────────────────
   *
   * A bot may hold TWO subscriptions — a LONG protocol and a SHORT protocol — as ONE strategy
   * (#714's design, proven by `signal-queue-paired-legs.spec.ts`). "Summarise the strategy per leg
   * and combined" needs each closed trade to name its leg, and `trade` had no protocol reference at
   * all, so two legs' results were indistinguishable after the close.
   *
   * ⚠️ Stored, not re-joined. The subscription's role can be edited after the trade, and
   * `brokerComment` is rewritten by reconciliation — so both values are copied at entry, exactly as
   * `abTestSide` above is.
   *
   * `undefined` means NOT ATTRIBUTED (a single-leg bot, or an older row). It must render as unknown,
   * never as `long`.
   */
  legProtocolId?: string;
  legRole?: 'long' | 'short' | 'both';
  openedAt?: Date;
  /** MT5 broker fields for traceability */
  ticket?: number;
  /** 64-bit-safe broker position/order ID — the PRIMARY link to the broker (#616). */
  brokerTicket?: string;
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
      // Clamp the legacy Int ticket to 32-bit range — MT5's 64-bit tickets
      // MUST go through brokerTicket (string) instead (#616).
      const safeTicket = trade.ticket != null && trade.ticket >= 0 && trade.ticket <= 2147483647
        ? Math.round(trade.ticket)
        : null;

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
          abTestSide: trade.abTestSide ?? null,
          // #1185 — the LEG that produced this trade. Copied, never re-joined later.
          legProtocolId: trade.legProtocolId ?? null,
          legRole: trade.legRole ?? null,
          openedAt: trade.openedAt || new Date(),
          closedAt: trade.status === 'closed' ? new Date() : null,
          // MT5 traceability (#446, #616)
          ticket: safeTicket,
          brokerTicket: trade.brokerTicket ?? null,
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
  async close(
    id: string,
    exitPrice: number,
    pnl: number,
    /**
     * WHY it closed — see `common/trading/close-reason.ts`.
     *
     * ⚠️ REQUIRED, with no default (#1255, 2026-11-12). It used to default to `user:manual` on the
     * stated grounds that "the ONLY caller is the API close path". That reasoning was sound but the
     * default was still a hazard: a default that names a PERSON is the wrong default for a shared
     * writer, so the next close path to forget a reason would silently blame the operator.
     *
     * Measured 2026-11-12 before removing it — `grep -rn 'tradeRecorder\.close(' nest/src` returns
     * exactly ONE call site (`mt5-trading.service.ts`, which always passes a reason), so requiring
     * the argument breaks no caller and makes the omission a compile error rather than a wrong
     * attribution. The nine `user:manual` closes this issue opened with were NOT this default: their
     * broker deals carry `reason: 0` and an EMPTY comment, i.e. they were closed from the MT5 client
     * side, and `closeReasonFromDealReason(0)` maps them to `user:manual` by owner direction
     * (2026-10-07, R46). See #1255.
     *
     * REGISTER: docs/SETTLED-DECISIONS.md row 170 · ISSUE: #1255
     */
    closeReason: string,
    /**
     * The strategy name this close belongs to (#884).
     *
     * ⚠️ WHY THIS PARAMETER EXISTS. Measured 2026-09-19: of 155 closed rows, TWO carried a
     * strategy — and both were phantoms. The app recorded the strategy when a trade was
     * REFUSED (reject path) and dropped it when the trade was TAKEN and closed, so every
     * performance comparison was built on the half of the ledger nobody wants. The caller
     * parses the MT5 position comment with `extractStrategyFromComment()` and passes it here.
     *
     * Optional and additive: when it is absent the existing column value is left alone — a
     * reconciler closing a row must not erase a tag the open path wrote.
     */
    strategy?: string,
  ): Promise<boolean> {
    try {
      await this.prisma.trade.update({
        where: { id },
        data: {
          exitPrice,
          pnl,
          status: 'closed',
          closedAt: new Date(),
          closeReason,
          ...(strategy ? { strategy } : {}),
        },
      });
      this.syslog.trade('TradeRecorder', `Trade closed: ${id} exit=${exitPrice} PnL=${pnl.toFixed(2)} why=${closeReason}`);
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
