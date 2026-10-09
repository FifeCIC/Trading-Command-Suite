import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TcsNoticeException } from '../../common/notices/tcs-notice.exception';
// ⚠️ A blocked trade writes a durable alert (2026-09-23) — see the refusal in placeManualTrade().
import { AlertsService } from '../alerts/alerts.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { ExecutionFeasibilityService } from '../trading/execution-feasibility.service';
// ⚠️ #945 — the manual path runs the SAME portfolio risk gate as the bot path
// (`assessGlobalRiskLimits`). Without this import the header comment below was a claim the code
// did not honour: measured 2026-09-21, 0.1 lots of gold — 23.6× the account balance — reached
// broker.placeOrder() with all six portfolio caps unasked.
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { ManualTradeDefaultsService } from './manual-trade-defaults.service';
import { ManualTradeDto } from './dto/manual-trade.dto';
import { SignalPlanDto } from './dto/signal-plan.dto';

export type BotActionState = 'none' | 'pending' | 'filled';

/**
 * SignalActionsService — the actionable layer behind the Signals area (#662).
 *
 * Signals are the "best of" opportunities surfaced for action. This service:
 *   1. Reports whether the trading bot has already acted on a signal.
 *   2. Places a MANUAL trade for a signal through the SAME pre-trade chain the bot uses:
 *      `feasibility.assess()` (#723 — duplicate guard, diversification, cooldown, size
 *      floors) AND `assessGlobalRiskLimits()` (#945 — the six portfolio caps).
 *
 *   ⚠️ WHAT THIS PATH DOES NOT RUN, stated on purpose (#945): an inaccurate safety claim is
 *   worse than none — this comment used to read "...never bypassing the risk controls" while
 *   `assessGlobalRiskLimits` had no caller here AT ALL, and 0.1 lots of gold (23.6× the
 *   account) reached `broker.placeOrder()` with every cap skipped.
 *     · The automation loop's DECISION gates (score thresholds, direction authority, session
 *       gate) — those run upstream of any order in the bot flow; a manual click IS the
 *       operator overriding them deliberately.
 *     · The sizing/notional PREVIEW (showing resolved margin before the click) — tracked as
 *       the remaining half of #945.
 *     · The bot's stop-guardian registration — identical behaviour for manual positions is
 *       unverified, not assumed.
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
    // #945 — the portfolio risk gate. Same call the bot path makes (automation-loop L407/L2100,
    // evaluateAndTrade). Its refusal is a TCS-RISK-001 notice naming the cap and the number.
    private readonly strategyService: TradingStrategyService,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly tradeDefaults: ManualTradeDefaultsService,
    private readonly alerts: AlertsService,
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
      // #826 Phase 1 — raise the CODE, not just a sentence.
      //
      // This threw `new BadRequestException(first.message)`, which discarded two things that
      // the library had already computed:
      //
      //   · `hint` — the only actionable remedy ("Raise the manual trade size to at least …").
      //     The client had nothing to offer but a generic transport fix.
      //   · the blocker's identity — no `code`, so `noticeFromError()` fell through to its
      //     HTTP-status branch and rendered `TCS-SYS-002`, *the API failed*, for what is a
      //     domain refusal, not a transport fault.
      //
      // Measured 2026-09-20: a BTC manual trade was refused with a correctly-worded message
      // and a remedy that could not work, and the operator had no way to tell it apart from a
      // dead API. The broker-result path directly below already forwards `code`/`params` for
      // exactly this reason (#826 Phase 3) — the feasibility path was simply missed.
      //
      // ⚠️ The status comes from the catalogue (`TCS-RISK-001` = 400), not from here. An
      // earlier draft overrode it at this call site; the class deliberately derives it so two
      // throw sites cannot disagree about what the same condition means. 400 preserves what
      // this endpoint has always returned — a pre-trade refusal is client-actionable.
      const first = feas.blockers[0];
      const reason = [first.message, first.hint].filter(Boolean).join(' · ');

      // ⚠️ A BLOCK MUST OUTLIVE THE TOAST (2026-09-23). The refusal below is rendered by the
      // client, read once, dismissed — and then NOTHING recorded that a trade was refused.
      // Measured: a FRA40 manual buy blocked by the 0.1-lot broker floor left no trace anywhere
      // except a transient panel. This writes it through addAlert(), so a repeated refusal of
      // the same symbol + reason COLLAPSES into one alert with a repeat count instead of
      // flooding the bell (see AlertsService.addAlert).
      //
      // ⚠️ The refusal must NOT depend on this write. `addAlert` swallows its own errors, but the
      // call site defends too: a failing alerts table cannot become a 500 instead of the refusal
      // (spec: "still refuses correctly when the alert write itself fails").
      try {
        await this.alerts.addAlert(
          'trading',
          `Trade blocked: ${ticker}`,
          `${reason}${first.key ? ` (${first.key})` : ''}`,
          'warning',
          ticker,
        );
      } catch (err) {
        this.logger.warn(`Could not record the blocked trade as an alert: ${(err as Error).message}`);
      }

      throw new TcsNoticeException(
        'TCS-RISK-001',
        { reason },
        first.key ? { detail: `blocker: ${first.key}` } : {},
      );
    }

    // ── Portfolio risk gate (#945) ───────────────────────────────────────────────────────────
    // The SAME gate the bot path runs before any order (automation-loop L407/L2100,
    // evaluateAndTrade L1623). Measured 2026-09-21: a manual gold buy at 0.1 lots — 23.6× the
    // £1,376 account — reached broker.placeOrder() with all six caps unasked, because this call
    // did not exist on this path. It does now. A refusal must NOT depend on the alert write (the
    // feasibility refusal above set that precedent): a failing alerts table produces the coded
    // refusal, never a 500.
    const riskGate = await this.strategyService.assessGlobalRiskLimits(quantity, ticker);
    if (!riskGate.allowed) {
      try {
        await this.alerts.addAlert(
          'trading',
          `Trade blocked: ${ticker}`,
          `${riskGate.reason} (portfolio risk gate #945)`,
          'warning',
          ticker,
        );
      } catch (err) {
        this.logger.warn(`Could not record the blocked trade as an alert: ${(err as Error).message}`);
      }
      // TCS-RISK-001's message is `The trade was blocked: {reason}` — the gate's own reason
      // already NAMES the cap and the number (e.g. "Position size 5 exceeds risk.maxPositionSize
      // (1)"), which is exactly the #826 requirement: a coded refusal the client can render.
      throw new TcsNoticeException('TCS-RISK-001', { reason: riskGate.reason });
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
        // #866 (2026-10-09) — forward the OUTCOME STATE, not just the refusal detail.
        // The adapter distinguishes "refused" from "UNKNOWN: sent but the response was lost";
        // dropping `status` here made every timeout reach the client as a plain refusal, which
        // reads as "the order was not placed" — the one claim nobody can make. The client's
        // tradeFailureNotice() branches on this field and renders the unknown-outcome notice.
        // (Deliberately no notice code named here: the backend never emits one for this — the
        // client picks it — and naming it made the notices validator require a server-catalogue
        // entry for a code this side cannot produce.)
        status: result.status,
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
