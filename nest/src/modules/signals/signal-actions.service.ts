import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { DuplicateGuardService } from '../trading/duplicate-guard.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { GlobalDiversificationService } from '../diversification/global-diversification.service';
import { ManualTradeDto } from './dto/manual-trade.dto';

export type BotActionState = 'none' | 'pending' | 'filled';

/**
 * SignalActionsService — the actionable layer behind the Signals area (#662).
 *
 * Signals are the "best of" opportunities surfaced for action. This service:
 *   1. Reports whether the trading bot has already acted on a signal.
 *   2. Places a MANUAL trade for a signal through the SAME safety chain the
 *      bot uses (duplicate guard, diversification, cooldown) — never bypassing
 *      the risk controls.
 *
 * Signal identity: a signal is a Score row (the runs API exposes `s.id` as the
 * run/signal id). Bot actions are correlated via decision_log (EXECUTED/QUEUED)
 * and the trade table (scoringStrategyId = protocol id).
 */
@Injectable()
export class SignalActionsService {
  private readonly logger = new Logger(SignalActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly duplicateGuard: DuplicateGuardService,
    private readonly diversification: GlobalDiversificationService,
    private readonly tradeRecorder: TradeRecorderService,
  ) {}

  /** Load a signal (Score row) or throw. */
  private async loadSignal(signalId: string) {
    const score = await (this.prisma as any).score
      .findUnique({
        where: { id: signalId },
        include: { symbol: { select: { ticker: true } } },
      })
      .catch(() => null);
    if (!score) {
      throw new NotFoundException(`Signal ${signalId} not found`);
    }
    const breakdown = score.breakdown || {};
    return {
      score,
      symbol: (score.symbol?.ticker || '').toUpperCase(),
      protocolId: breakdown.protocolId ?? score.strategyId ?? null,
      strategyId: score.strategyId,
      scoredAt: score.timestamp ? new Date(score.timestamp) : null,
      marketStatus: breakdown.marketStatus ?? null,
    };
  }

  /**
   * GET /api/signals/:id/action
   *
   * Bot-action state for a signal:
   *   none    — the bot has not acted on this signal
   *   pending — an order/decision is queued or in-flight
   *   filled  — the bot (or a manual action) has executed a trade
   */
  async getBotAction(signalId: string) {
    const { symbol, protocolId, strategyId, scoredAt } = await this.loadSignal(signalId);

    // 1. Bot decisions since the score (decision_log EXECUTED/QUEUED)
    const decisions: any[] = await (this.prisma as any).decisionLog
      .findMany({
        where: scoredAt
          ? { strategyId, symbol, timestamp: { gte: scoredAt } }
          : { strategyId, symbol },
        orderBy: { timestamp: 'desc' },
        take: 10,
      })
      .catch(() => []);

    const executed = decisions.find((d) => d.decision === 'EXECUTED');
    if (executed) {
      return {
        signalId,
        symbol,
        protocolId,
        action: 'filled' as BotActionState,
        orderId: executed.ticket ?? null,
        filledAt: executed.timestamp ? new Date(executed.timestamp).toISOString() : null,
        source: 'decision_log',
      };
    }
    if (decisions.some((d) => d.decision === 'QUEUED')) {
      return {
        signalId,
        symbol,
        protocolId,
        action: 'pending' as BotActionState,
        orderId: null,
        filledAt: null,
        source: 'decision_log',
      };
    }

    // 2. Trades correlated via scoringStrategyId (bot writes protocolId there)
    const trade: any = await (this.prisma as any).trade
      .findFirst({
        where: { scoringStrategyId: strategyId, symbol, status: 'open' },
        orderBy: { openedAt: 'desc' },
      })
      .catch(() => null);
    if (trade) {
      return {
        signalId,
        symbol,
        protocolId,
        action: 'filled' as BotActionState,
        orderId: trade.brokerTicket ?? trade.ticket ?? trade.id,
        filledAt: trade.openedAt ? new Date(trade.openedAt).toISOString() : null,
        source: 'trade',
      };
    }

    return { signalId, symbol, protocolId, action: 'none' as BotActionState, orderId: null, filledAt: null, source: null };
  }

  /**
   * POST /api/signals/:id/trade
   *
   * Place a manual trade for a signal through the same safety chain as the bot:
   * market-status gate → duplicate guard → diversification → 60s cooldown →
   * broker.placeOrder with SL/TP, then recorded as origin=manual.
   */
  async placeManualTrade(signalId: string, body: ManualTradeDto) {
    const { symbol, protocolId } = await this.loadSignal(signalId);

    const ticker = (body.symbol || symbol || '').toUpperCase();
    const protocol = body.protocolId || protocolId || null;
    const brokerId = body.brokerId || 'mt5';
    if (!ticker) throw new BadRequestException('No symbol resolved for this signal');

    // 1. Market-status gate (the score's own tradability state)
    const marketStatus = (await this.loadSignal(signalId)).marketStatus;
    if (marketStatus && marketStatus.open === false) {
      throw new BadRequestException(`Market closed for ${ticker} — manual trade blocked (${marketStatus.reason || 'closed'})`);
    }

    // 2. Duplicate guard — same check the bot runs
    const dup = await this.duplicateGuard.checkDuplicate(ticker, brokerId, protocol ?? undefined);
    if (dup.blocked) throw new BadRequestException(dup.reason || 'Duplicate position');

    // 3. Diversification pre-check — same check the bot runs
    const div = await this.diversification.checkPreTrade(ticker, brokerId);
    if (div.blocked) throw new BadRequestException(`Diversification: ${div.reason}`);

    // 4. 60s symbol cooldown — DB-backed mirror of the bot's cooldown
    const recentTrade = await (this.prisma as any).trade
      .findFirst({
        where: { symbol: ticker, openedAt: { gte: new Date(Date.now() - 60_000) } },
        orderBy: { openedAt: 'desc' },
      })
      .catch(() => null);
    if (recentTrade) {
      throw new BadRequestException(`${ticker} traded within the last 60s — cooldown active`);
    }

    const broker = this.adapterFactory.create(brokerId);
    if (!broker?.placeOrder) {
      throw new BadRequestException(`Broker ${brokerId} does not support order placement`);
    }

    // 5. Sizing + SL/TP (explicit in body; safe defaults otherwise)
    const quantity = body.size ?? 0.01;
    const slPct = body.slPct ?? 2;
    const tpPct = body.tpPct ?? 4;

    let entryPrice: number | null = null;
    try {
      const q: any = await broker.getQuote(ticker);
      entryPrice = q?.last ?? q?.price ?? q?.bid ?? q?.close ?? null;
    } catch {
      entryPrice = null;
    }

    const sl = entryPrice != null
      ? (body.side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100))
      : undefined;
    const tp = entryPrice != null
      ? (body.side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100))
      : undefined;

    const comment = `TCS manual ${protocol ?? 'signal'} | ${signalId.slice(0, 8)}`;

    // 6. Execute through the broker adapter
    const result = await broker.placeOrder({
      symbol: ticker,
      side: body.side,
      quantity,
      sl,
      tp,
      comment,
    });

    if (!result.success) {
      return { success: false, signalId, symbol: ticker, protocolId: protocol, error: result.error || 'Order failed' };
    }

    // 7. Record as a manual trade (origin=manual, source=signals)
    try {
      await this.tradeRecorder.record({
        symbol: ticker,
        side: body.side.toLowerCase(),
        quantity,
        entryPrice: result.price || entryPrice || 0,
        pnl: 0,
        provider: brokerId,
        status: 'open',
        origin: 'manual',
        source: 'signals',
        scoringStrategyId: protocol ?? null,
        ticket: typeof result.ticket === 'number' ? result.ticket : undefined,
        sl: sl ?? null,
        tp: tp ?? null,
        brokerComment: typeof result.ticket === 'string' ? `${comment} (${result.ticket})` : comment,
      } as any);
    } catch (err) {
      this.logger.warn(`Manual trade executed but recording failed: ${(err as Error).message}`);
    }

    return {
      success: true,
      signalId,
      symbol: ticker,
      protocolId: protocol,
      orderId: result.ticket ?? null,
      price: result.price ?? entryPrice,
      quantity,
      sl: sl ?? null,
      tp: tp ?? null,
      status: 'open',
    };
  }
}
