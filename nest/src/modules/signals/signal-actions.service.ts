import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { ExecutionFeasibilityService } from '../trading/execution-feasibility.service';
import { ManualTradeDefaultsService } from './manual-trade-defaults.service';
import { ManualTradeDto } from './dto/manual-trade.dto';
import { SignalPlanDto } from './dto/signal-plan.dto';

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
    private readonly feasibility: ExecutionFeasibilityService,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly tradeDefaults: ManualTradeDefaultsService,
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
    const { symbol, protocolId, marketStatus } = await this.loadSignal(signalId);

    const ticker = (body.symbol || symbol || '').toUpperCase();
    const protocol = body.protocolId || protocolId || null;
    const brokerId = body.brokerId || 'mt5';
    if (!ticker) throw new BadRequestException('No symbol resolved for this signal');

    const broker = this.adapterFactory.create(brokerId);
    if (!broker?.placeOrder) {
      throw new BadRequestException(`Broker ${brokerId} does not support order placement`);
    }

    // 5. Sizing + SL/TP — explicit in body, else the persisted Settings defaults
    //    (#720). Defaults are read at order time so Settings edits apply live.
    //
    // ⚠️ Read BEFORE the feasibility assessment below, because the SIZE is one of the
    // facts that assessment needs: brokers enforce a per-symbol volume floor, and "your
    // size is below this broker's minimum" is a refusal the app can predict instead of
    // discovering it after the click (measured: US500's floor is 0.1 lots on both bridges
    // while the manual default is 0.01).
    const defaults = await this.tradeDefaults.getDefaults();
    const quantity = body.size ?? defaults.size;
    const slPct = body.slPct ?? defaults.slPct;
    const tpPct = body.tpPct ?? defaults.tpPct;

    // #723 — the SAME feasibility assessment that annotated the signal at
    // generation time, re-run as the authoritative execution check (state can
    // change between generation and click). One library, two phases.
    const feas = await this.feasibility.assess({
      symbol: ticker,
      side: body.side,
      brokerId,
      protocolId: protocol,
      marketStatus: marketStatus as any,
      size: quantity,
    });
    if (!feas.feasible) {
      const first = feas.blockers[0];
      throw new BadRequestException(first.message);
    }

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
      clientOrderId: `signal-${signalId}`,
    });

    if (!result.success) {
      // #826 Phase 3 — forward the notice code/params from the broker adapter. Without this the
      // code is dropped here and the client can only show the broker's sentence, which is exactly
      // how "Unsupported filling mode" reached a user with nothing to act on.
      return {
        success: false,
        signalId,
        symbol: ticker,
        protocolId: protocol,
        error: result.error || 'Order failed',
        code: result.code,
        params: result.params,
        external: result.external,
      };
    }

    // 7. Record as a manual trade (origin=manual, source=signals)
    try {
      // MT5 tickets are 64-bit — persist via brokerTicket (string), never the
      // legacy Int `ticket` column (#616).
      const brokerTicket = result.ticket != null ? String(result.ticket) : undefined;
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
        brokerTicket,
        magic: 234000, // bridge hardcodes magic=234000 (see mt5_bridge_v2.py /order)
        sl: sl ?? null,
        tp: tp ?? null,
        brokerComment: comment,
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

  /**
   * POST /api/signals/:id/plan (#702)
   *
   * Signals → Trading handover: queue the signal into the Trading area as a
   * draft trading plan that carries the full signal context (direction,
   * protocol, combined strength, top drivers, warnings) so the Trading area
   * can show exactly where the plan came from.
   *
   * One plan per signal — duplicates are rejected with the existing plan id.
   */
  async createSignalPlan(signalId: string, body: SignalPlanDto) {
    const { symbol, protocolId, scoredAt } = await this.loadSignal(signalId);

    const direction = (body.direction || 'LONG').toUpperCase();
    const ctx = body.context || {};
    const combined = ctx.combinedStrength ?? null;
    const signalPct = ctx.signalPct ?? null;
    const opportunityPct = ctx.opportunityPct ?? null;
    const confidence = ctx.confidence ?? null;
    const top = (ctx.topDirectives || []).slice(0, 3);
    const protocolLabel = body.protocolName || protocolId || 'signal';

    // Dedupe — one plan per symbol+protocol+direction. The signalId is a
    // Score-run id (a new row per scoring run), so it cannot be the key.
    const existing: any[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT id FROM tradingplan
       WHERE JSON_UNQUOTE(JSON_EXTRACT(content, '$.source')) = 'signals'
         AND JSON_UNQUOTE(JSON_EXTRACT(content, '$.symbol')) = ?
         AND IFNULL(JSON_UNQUOTE(JSON_EXTRACT(content, '$.protocolId')), '') = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(content, '$.direction')) = ?
       LIMIT 1`,
      symbol,
      protocolId ?? '',
      direction,
    ).catch(() => []);
    if (existing?.length) {
      return { success: false, existingPlanId: existing[0].id, message: 'This signal already has a trading plan' };
    }

    const drivers = top.map((d: any) => d.name).filter(Boolean).join(', ');
    const notes = [
      `Signals handover — ${direction} ${symbol} via ${protocolLabel}`,
      combined != null ? `Combined strength ${combined}` : null,
      signalPct != null ? `Signal ${signalPct}%` : null,
      opportunityPct != null ? `Opportunity ${opportunityPct}%` : null,
      confidence != null ? `Confidence ${confidence}` : null,
      drivers ? `Top drivers: ${drivers}` : null,
    ].filter(Boolean).join(' · ');

    const plan = await (this.prisma as any).tradingPlan.create({
      data: {
        title: `${symbol} ${direction} — ${protocolLabel}`,
        type: 'signal',
        content: {
          source: 'signals',
          signalId,
          symbol,
          direction,
          protocolId: protocolId ?? null,
          protocolName: body.protocolName ?? null,
          combinedStrength: combined,
          signalPct,
          opportunityPct,
          confidence,
          scoredAt: scoredAt ? scoredAt.toISOString() : null,
          topDirectives: top,
          warnings: ctx.warnings || [],
        },
        notes,
        status: 'draft',
        symbols: [symbol],
      },
    });

    // First plan step: the pending entry this signal suggests.
    await (this.prisma as any).planStep
      .create({
        data: {
          planId: plan.id,
          action: direction === 'SHORT' ? 'sell' : 'buy',
          symbol,
          conditions: `Signal handover: ${direction} via ${protocolLabel} (combined ${combined ?? 'n/a'})`,
          notes: drivers ? `Top drivers: ${drivers}` : null,
          sortOrder: 0,
        },
      })
      .catch((err: any) => this.logger.warn(`Plan step create failed: ${err?.message}`));

    this.logger.log(`Signal ${signalId.slice(0, 8)} handed over to plan ${plan.id} (${symbol} ${direction})`);
    return { success: true, planId: plan.id, title: plan.title };
  }
}
