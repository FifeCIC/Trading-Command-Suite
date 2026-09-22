/**
 * TradeHistoryController — unified trade audit trail
 * ====================================================
 * Reads from the Prisma Trade model for all providers.
 */

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { PrismaService } from '../../database/prisma.service';
import { Mt5TradingService } from './mt5-trading.service';
import { SwapCostService } from './swap-cost.service';
import { WeekendDefenseService } from './weekend-defense.service';
import { PositionSyncService } from '../providers/position-sync.service';
// #894 — portfolio-scope per-bot realised performance, the data half of the bot rating.
import { BotPerformanceService, DEFAULT_RATING_POLICY } from './bot-performance.service';
// #884 — the ONE comment parser. The live-positions fallback below used to hand-roll its own.
import { extractStrategyFromComment } from '../providers/mt5-comment.util';

@Controller('trading')
export class TradeHistoryController {
  private readonly logger = new Logger(TradeHistoryController.name);

  constructor(
    private readonly tradeRecorder: TradeRecorderService,
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5TradingService,
    private readonly swapCost: SwapCostService,
    private readonly weekendDefense: WeekendDefenseService,
    private readonly positionSync: PositionSyncService,
    private readonly botPerformance: BotPerformanceService,
  ) {}

  /**
   * GET /api/trading/position-lifecycle
   *
   * Lab prototype data feed — the full position lifecycle in one payload:
   * broker `position` rows (with 64-bit brokerTicket), reconciled `trade`
   * rows, and recent stop adjustments. Backs the Position Lifecycle Monitor.
   */
  @Get('position-lifecycle')
  async getPositionLifecycle() {
    const [positions, trades, adjustments] = await Promise.all([
      (this.prisma as any).position.findMany({
        orderBy: { lastQuotedAt: 'desc' },
        take: 200,
      }).catch(() => []),
      this.prisma.trade.findMany({
        where: { status: { in: ['open', 'closed'] } },
        orderBy: { openedAt: 'desc' },
        take: 200,
      }).catch(() => []),
      (this.prisma as any).stopAdjustment.findMany({
        orderBy: { adjustedAt: 'desc' },
        take: 50,
      }).catch(() => []),
    ]);

    const openTrades = trades.filter((t: any) => t.status === 'open').length;
    const closedTrades = trades.filter((t: any) => t.status === 'closed').length;

    return {
      positions,
      trades,
      adjustments,
      sync: {
        lastSyncedAt: this.positionSync.getLastSyncTime(),
        openPositions: positions.length,
        openTrades,
        closedTrades,
      },
    };
  }

  /** Get trade history from the audit trail (all providers) */
  @Get('trade-history')
  async getHistory(
    @Query('provider') provider?: string,
    @Query('symbol') symbol?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.tradeRecorder.getHistory({
      provider,
      symbol,
      days: days ? Number(days) : 30,
      limit: limit ? Number(limit) : 200,
      status,
    });
  }

  /**
   * GET /api/trading/strategy-comparison
   *
   * Compare trading strategies by actual trade outcomes.
   * Returns aggregate stats per strategy + live positions grouped by strategy.
   */
  @Get('strategy-comparison')
  async getStrategyComparison() {
    // ── 1. Stats from closed trades grouped by strategy ──
    //
    // ⚠️ #884 — THE FILTER IS THE FIX. It used to read `pnl: { not: null }`, intending "only
    // trades whose P&L we know". Rows whose exit was never priced store 0, NOT NULL — measured
    // 103 of 155 closed rows had `exitPrice=NULL, pnl=0` — so the filter passed every unpriced
    // row and the page aggregated fabricated zeros as results. `exitPrice: { not: null }` is
    // the honest test: a trade with no realised exit price cannot be scored, and is EXCLUDED
    // (and counted in `excluded` below so the page can say so — development-philosophy §7).
    const closedTrades = await this.prisma.trade.findMany({
      where: {
        status: 'closed',
        strategy: { not: null },
        exitPrice: { not: null },
        pnl: { not: null },
      },
      orderBy: { closedAt: 'desc' },
      take: 2000,
    }).catch(() => []);

    const strategyMap = new Map<string, {
      trades: number;
      wins: number;
      losses: number;
      /** Priced closes that netted exactly zero — NOT wins, NOT losses (#884). */
      breakEven: number;
      totalPnl: number;
      avgWinPnl: number;
      avgLossPnl: number;
      bestTrade: number;
      worstTrade: number;
      winAmounts: number[];
      lossAmounts: number[];
      cumPnlHistory: number[];
      symbols: Set<string>;
    }>();

    for (const t of closedTrades) {
      const key = t.strategy || 'unknown';
      if (!strategyMap.has(key)) {
        strategyMap.set(key, {
          trades: 0, wins: 0, losses: 0, breakEven: 0, totalPnl: 0,
          avgWinPnl: 0, avgLossPnl: 0, bestTrade: -Infinity, worstTrade: Infinity,
          winAmounts: [], lossAmounts: [], cumPnlHistory: [], symbols: new Set(),
        });
      }
      const s = strategyMap.get(key)!;
      s.trades++;
      s.totalPnl += t.pnl || 0;
      s.symbols.add(t.symbol);
      // ⚠️ #884 — `t.pnl && t.pnl >= 0` treated 0 as FALSY and counted a priced break-even
      // as a LOSS of $0. Three-way bucket now: > 0 win, < 0 loss, === 0 break-even (reported,
      // not silently mislabelled).
      const pnl = t.pnl ?? 0;
      if (pnl > 0) {
        s.wins++;
        s.winAmounts.push(pnl);
        if (pnl > s.bestTrade) s.bestTrade = pnl;
      } else if (pnl < 0) {
        s.losses++;
        s.lossAmounts.push(pnl);
        if (pnl < s.worstTrade) s.worstTrade = pnl;
      } else {
        s.breakEven++;
      }
      s.cumPnlHistory.push(s.totalPnl);
    }

    // Compute derived metrics
    const showdown = Array.from(strategyMap.entries()).map(([name, s]) => {
      const winRate = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const avgWin = s.winAmounts.length > 0
        ? Math.round(s.winAmounts.reduce((a, b) => a + b, 0) / s.winAmounts.length * 100) / 100
        : 0;
      const avgLoss = s.lossAmounts.length > 0
        ? Math.round(s.lossAmounts.reduce((a, b) => a + b, 0) / s.lossAmounts.length * 100) / 100
        : 0;

      // Max drawdown from cum P&L
      let peak = 0;
      let maxDd = 0;
      for (const cum of s.cumPnlHistory) {
        if (cum > peak) peak = cum;
        const dd = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
      }

      return {
        strategy: name,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        breakEven: s.breakEven,
        winRate,
        totalPnl: Math.round(s.totalPnl * 100) / 100,
        avgWinPnl: avgWin,
        avgLossPnl: Math.round(avgLoss * 100) / 100,
        bestTrade: s.bestTrade === -Infinity ? 0 : Math.round(s.bestTrade * 100) / 100,
        worstTrade: s.worstTrade === Infinity ? 0 : Math.round(s.worstTrade * 100) / 100,
        maxDrawdown: Math.round(maxDd * 10) / 10,
        symbolCount: s.symbols.size,
        profitFactor: s.lossAmounts.reduce((a, b) => a + Math.abs(b), 0) > 0
          ? Math.round((s.winAmounts.reduce((a, b) => a + b, 0) / s.lossAmounts.reduce((a, b) => a + Math.abs(b), 0)) * 100) / 100
          : null,
      };
    }).sort((a, b) => b.totalPnl - a.totalPnl);

    // ── 2. Live positions — DB first, MT5 bridge fallback ──
    const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const openTrades = await this.prisma.trade.findMany({
      where: { 
        status: 'open',
        openedAt: { gte: staleThreshold },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    }).catch(() => []);

    const liveByStrategy = new Map<string, any[]>();
    let liveSource = 'DB (stale-filtered, ≤7 days)';

    if (openTrades.length > 0) {
      for (const t of openTrades) {
        const key = t.strategy || 'manual';
        if (!liveByStrategy.has(key)) liveByStrategy.set(key, []);
        liveByStrategy.get(key)!.push({
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          entryPrice: t.entryPrice,
          pnl: t.pnl || 0,
          openedAt: t.openedAt,
          provider: t.provider,
        });
      }
    } else {
      // Fallback: query MT5 bridge directly
      try {
        const mt5Positions = await this.mt5.getPositions();
        for (const p of mt5Positions) {
          // #884 — canonical parser (was a hand-rolled copy: prefix + score regex inline).
          const strategyKey = extractStrategyFromComment(p.comment) || 'unknown';
          if (!liveByStrategy.has(strategyKey)) liveByStrategy.set(strategyKey, []);
          liveByStrategy.get(strategyKey)!.push({
            symbol: p.symbol,
            side: p.type === 0 ? 'buy' : 'sell',
            quantity: p.volume,
            entryPrice: p.price_open,
            currentPrice: p.price_current,
            pnl: p.profit || 0,
            openedAt: new Date(p.time * 1000).toISOString(),
            ticket: p.ticket,
            sl: p.sl,
            tp: p.tp,
            provider: 'mt5',
          });
        }
        liveSource = 'MT5 bridge (live positions)';
      } catch (err) {
        this.logger.warn(`MT5 bridge unavailable for live positions: ${(err as Error).message}`);
        liveSource = 'MT5 bridge unavailable';
      }
    }

    // ⚠️ #884 — what this response CANNOT judge, counted rather than hidden. The comparison
    // page renders these so a sparse or empty showdown reads as "not enough priced, tagged
    // closes" rather than "the strategies made nothing" (development-philosophy §7).
    const [totalClosed, noStrategyCount, unpricedCount] = await Promise.all([
      this.prisma.trade.count({ where: { status: 'closed' } }),
      this.prisma.trade.count({ where: { status: 'closed', strategy: null } }),
      this.prisma.trade.count({ where: { status: 'closed', exitPrice: null } }),
    ]).catch(() => [0, 0, 0] as number[]);

    return {
      generatedAt: new Date().toISOString(),
      liveSource,
      showdown,
      excluded: {
        totalClosed,
        noStrategy: noStrategyCount,
        unpriced: unpricedCount,
      },
      livePositions: Array.from(liveByStrategy.entries()).map(([strategy, positions]) => ({
        strategy,
        positionCount: positions.length,
        totalPnl: Math.round(positions.reduce((s, p) => s + (p.pnl || 0), 0) * 100) / 100,
        positions,
      })),
      activeStrategies: showdown.length,
      totalStrategies: showdown.length,
    };
  }

  /**
   * GET /api/trading/bot-performance
   *
   * "Which bots are actually working?" — per-bot realised performance at PORTFOLIO scope, with
   * an explicit rating gate. The data half of #894 (bot rating); nothing here renders.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * WHY A NEW ENDPOINT RATHER THAN REUSING `strategy-comparison`
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * `strategy-comparison` groups by `trade.strategy` — a NAME STRING — and that column is null
   * on 184 of 186 closed trades (measured 2026-09-22, #949). A rating built on it would be a
   * rating of two trades. It also groups by name, so two same-named bots merge and one renamed
   * bot splits. A rating must key on IDENTITY. This resolves `scoringStrategyId` → bot instead,
   * reporting `matched` and `attributionKind` so a protocol slug can never be mistaken for a bot.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ `rating: null` WITH a populated `blockers` array IS A SUCCESSFUL RESPONSE
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * #894: *"Building a rating on top of these would produce a confident number that means
   * nothing — which is worse than no rating, because an operator would act on it."*
   *
   * So this endpoint REFUSES to emit a rating it cannot justify, and says exactly what is
   * missing per bot. Expect `rating: null` on every row today; that is the honest answer, not a
   * fault. The UI must render `blockersDetail`, never an empty cell — an empty cell reads as
   * "fine" (development-philosophy §7).
   *
   * `policy` is overridable via query params so "what would qualify under different thresholds?"
   * is answerable without a restart — the recomputability #894 requires.
   */
  @Get('bot-performance')
  async getBotPerformance(
    @Query('minSamples') minSamples?: string,
    @Query('minWindowDays') minWindowDays?: string,
    @Query('maxDrawdownPct') maxDrawdownPct?: string,
  ) {
    // Only override what was actually supplied — a partially-parsed query must not silently
    // reset an unmentioned threshold to 0 and award every bot a rating.
    const policy: Partial<typeof DEFAULT_RATING_POLICY> = {};
    if (minSamples !== undefined && Number.isFinite(Number(minSamples))) {
      policy.minSamples = Number(minSamples);
    }
    if (minWindowDays !== undefined && Number.isFinite(Number(minWindowDays))) {
      policy.minWindowDays = Number(minWindowDays);
    }
    if (maxDrawdownPct !== undefined && Number.isFinite(Number(maxDrawdownPct))) {
      policy.maxDrawdownPct = Number(maxDrawdownPct);
    }
    return this.botPerformance.getBotPerformance({ policy });
  }

  // ── Protocol Profitability (#777) ─────────────────────

  /**
   * GET /api/trading/protocol-profitability
   *
   * "Is this profitable, and WHICH protocol makes money?" — the measurement prerequisite for every
   * tuning decision (#777). Not a dashboard: the numbers that make tuning possible at all.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ WHY THE EXISTING `strategy-comparison` COULD NOT ANSWER THIS
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   *   1. It groups by `trade.strategy` — a NAME STRING — not by protocol. So "which protocol earns"
   *      was unanswerable, and effort went to whichever protocol was loudest rather than whichever
   *      worked.
   *   2. It filters `pnl: { not: null }` and NOTHING ELSE, so the quarantined rows (pnlInvalid = 1,
   *      a placeholder 0 because the exit price was never captured) are **counted as real P&L**.
   *      Measured 2026-09-17: 80 of 129 strategy rows are quarantined, so that view is dominated by
   *      fabricated zeros and cannot be trusted in either direction.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   * THE THREE STATES A ZERO CAN MEAN (acceptance criterion 3)
   * ─────────────────────────────────────────────────────────────────────────────────────────────
   * A `0` is ambiguous and must never be averaged as if it were a result. This splits it:
   *
   *   QUARANTINED   `pnlInvalid = 1`          the exit was never captured; `pnl` is a placeholder.
   *                                           EXCLUDED, and COUNTED so it cannot vanish silently.
   *   EXIT_UNKNOWN  `exitPrice IS NULL`        we do not know the exit. EXCLUDED and counted.
   *                                           This is the case `strategy-comparison` mistook for 0.
   *   FLAT          `pnl = 0`, exit known      a genuine scratch. A RESULT, and it is counted as one.
   *
   * "Absence must not become a number" — the same invariant as #766.
   *
   * ⚠️ COSTS — the history, because the honest answer changed on 2026-09-22 (#777 criterion 2).
   * Measured 2026-09-17: `trade.swap` was null on every row and there was **no `commission`
   * column at all**, so the endpoint served `costs.available: false` and `grossPnl === netPnl`
   * *because costs were unmeasured, NOT because they were zero*. That was the honest answer then.
   * NOW: `position-sync.finalizeClosedPosition()` persists `commission` / `swap` / `fee` from the
   * CLOSING DEALS (the same sums `pnl` is built from), so coverage grows with each close.
   * `grossPnl` is served per protocol ONLY when every usable row in that protocol carries all
   * three components — `null` otherwise, because a gross figure over a partially-costed sample is
   * not a gross figure. `grossPnlCoverage` states which case each protocol is in.
   */
  @Get('protocol-profitability')
  async getProtocolProfitability() {
    const trades = await this.prisma.trade.findMany({
      where: { origin: 'strategy', status: 'closed' },
      select: {
        id: true, symbol: true, side: true, pnl: true, exitPrice: true,
        pnlInvalid: true, scoringStrategyId: true, openedAt: true, closedAt: true,
        // #777 — the persisted cost components (from closing deals). NULL = not captured for
        // that row (closed before 2026-09-22), never zero — see the `costs` block in the response.
        commission: true, swap: true, fee: true,
      },
      orderBy: { closedAt: 'desc' },
      take: 5000,
    }).catch(() => [] as any[]);

    // ─────────────────────────────────────────────────────────────────────────────────────
    // ATTRIBUTION — MEASURED 2026-09-17. It is NOT the chain the column name implies.
    //
    // ⚠️ `trade.scoringStrategyId` does NOT hold a `scoring_strategy.id`. Measured over the 31
    // distinct values on `trade`:
    //      0 of 31 match `scoring_strategy.id`
    //     16 of 31 match `trading_strategy.id`   ← the BOT id
    //    The column is DUAL-MEANING because two writers disagree about what goes in it:
    //      automation-loop.service.ts:1758  `scoringStrategyId: action.strategyId`  → bot id
    //      signal-actions.service.ts:235    `scoringStrategyId: protocol ?? null`   → protocol slug
    //    The row shapes confirm it: 129 rows are UUIDs (bot id), 16 rows are slugs.
    //
    // ⚠️ And `trading_strategy.protocolId` holds a SLUG, not a `protocol.id` (26 of 27 rows are
    // slugs). Joining on `protocol.id` returns nothing at all.
    //
    // The FIRST version of this endpoint used the chain the column NAME suggests
    // (scoringStrategyId → scoring_strategy.protocolId → protocol.slug). It resolved **0 of 26**
    // trades and reported every one as "unattributed" — a plausible number with no error, which is
    // precisely the defect class #777 exists to remove. Hence: a multi-path resolver, per-path
    // counts, and a VISIBLE unresolved list, so this can never fail silently again.
    // ─────────────────────────────────────────────────────────────────────────────────────
    const lookupFailures: string[] = [];
    /** An empty table and a failed query must never look the same (#777 criterion 4). */
    const readAll = async (label: string, fn: () => Promise<any[]>): Promise<any[]> => {
      try {
        return await fn();
      } catch (err) {
        lookupFailures.push(`${label}: ${(err as Error).message}`);
        return [];
      }
    };

    const bots = await readAll('trading_strategy', () =>
      (this.prisma as any).tradingStrategy.findMany({
        select: { id: true, name: true, protocolId: true, scoringStrategyId: true },
      }));
    const botById = new Map<string, any>(bots.map((b: any) => [b.id, b] as [string, any]));

    const protocols = await readAll('protocol', () =>
      (this.prisma as any).protocol.findMany({ select: { id: true, slug: true, name: true } }));
    const protocolById = new Map<string, any>(protocols.map((p: any) => [p.id, p] as [string, any]));
    const protocolBySlug = new Map<string, any>(protocols.map((p: any) => [p.slug, p] as [string, any]));

    /**
     * Resolve a `trade.scoringStrategyId` to a protocol, trying EVERY writer's convention.
     * Returns the path taken so the response can show which writers are actually in use —
     * if `protocol_slug` ever stops appearing, the signal-actions writer has changed shape.
     */
    const resolveProtocol = (sid: string | null): { proto: any; via: string } => {
      if (!sid) return { proto: null, via: 'no_id' };
      const bot = botById.get(sid);
      if (bot) {
        const viaBot = protocolBySlug.get(bot.protocolId) || protocolById.get(bot.protocolId);
        return viaBot ? { proto: viaBot, via: 'trading_strategy' } : { proto: null, via: 'bot_without_protocol' };
      }
      const viaSlug = protocolBySlug.get(sid);
      if (viaSlug) return { proto: viaSlug, via: 'protocol_slug' };
      const viaId = protocolById.get(sid);
      if (viaId) return { proto: viaId, via: 'protocol_id' };
      return { proto: null, via: 'unresolved' };
    };
    const resolvedVia: Record<string, number> = {};
    const unresolvedIds = new Set<string>();

    type Bucket = {
      protocolId: string | null;
      protocolSlug: string;
      protocolName: string;
      usable: number;
      wins: number;
      losses: number;
      flat: number;
      netPnl: number;
      winPnl: number;
      lossPnl: number;
      best: number | null;
      worst: number | null;
      holdMinutes: number[];
      symbols: Set<string>;
      firstAt: Date | null;
      lastAt: Date | null;
      costCommission: number;
      costSwap: number;
      costFee: number;
      rowsWithCosts: number;
      rowsWithoutCosts: number;
    };
    const buckets = new Map<string, Bucket>();

    let quarantined = 0;
    let exitUnknown = 0;

    for (const t of trades) {
      // ── Excluded, but counted. Never silently dropped. ──
      if (Number(t.pnlInvalid) === 1) { quarantined++; continue; }
      if (t.exitPrice == null) { exitUnknown++; continue; }

      const { proto, via } = resolveProtocol(t.scoringStrategyId ?? null);
      resolvedVia[via] = (resolvedVia[via] || 0) + 1;
      if (!proto && t.scoringStrategyId) unresolvedIds.add(t.scoringStrategyId);
      const key = proto?.slug || 'unattributed';

      if (!buckets.has(key)) {
        buckets.set(key, {
          protocolId: proto?.id ?? null,
          protocolSlug: proto?.slug ?? 'unattributed',
          protocolName: proto?.name ?? 'Not attributed to a protocol',
          usable: 0, wins: 0, losses: 0, flat: 0, netPnl: 0, winPnl: 0, lossPnl: 0,
          best: null, worst: null, holdMinutes: [], symbols: new Set(), firstAt: null, lastAt: null,
          costCommission: 0, costSwap: 0, costFee: 0, rowsWithCosts: 0, rowsWithoutCosts: 0,
        });
      }
      const b = buckets.get(key)!;
      const pnl = Number(t.pnl || 0);

      b.usable++;
      b.netPnl += pnl;
      // Cost capture: a row counts as captured only when ALL THREE components are present.
      // A partially-captured row would silently understate costs, which is the same shape of
      // error as a missing cost reported as 0.
      if (t.commission != null && t.swap != null && t.fee != null) {
        b.costCommission += Number(t.commission);
        b.costSwap += Number(t.swap);
        b.costFee += Number(t.fee);
        b.rowsWithCosts++;
      } else {
        b.rowsWithoutCosts++;
      }
      b.symbols.add(t.symbol);
      if (pnl > 0) { b.wins++; b.winPnl += pnl; }
      else if (pnl < 0) { b.losses++; b.lossPnl += pnl; }
      else b.flat++;
      if (b.best === null || pnl > b.best) b.best = pnl;
      if (b.worst === null || pnl < b.worst) b.worst = pnl;

      if (t.openedAt && t.closedAt) {
        const mins = (new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 60_000;
        if (Number.isFinite(mins) && mins >= 0) b.holdMinutes.push(mins);
      }
      const closed = t.closedAt ? new Date(t.closedAt) : null;
      if (closed) {
        if (!b.firstAt || closed < b.firstAt) b.firstAt = closed;
        if (!b.lastAt || closed > b.lastAt) b.lastAt = closed;
      }
    }

    /** Median, not mean: the mean hold time is skewed by stale rows (#773). */
    const median = (xs: number[]): number | null => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;

    /** ⚠️ Below this, a win rate is noise. Stated per protocol rather than implied. */
    const MIN_SAMPLE_FOR_VERDICT = 20;

    const perProtocol = [...buckets.values()].map((b) => {
      const costsCaptured = b.rowsWithCosts === b.usable && b.usable > 0;
      const costTotal = b.costCommission + b.costSwap + b.costFee;
      return {
        protocolId: b.protocolId,
        protocolSlug: b.protocolSlug,
        protocolName: b.protocolName,
        trades: b.usable,
        netPnl: r2(b.netPnl),
        /**
         * NET is `pnl` as stored — the broker's own sum (profit + commission + swap + fee).
         * GROSS is served ONLY when EVERY usable row in this protocol carries captured costs;
         * `null` otherwise, because a gross figure over a partially-costed sample is not a gross
         * figure. `grossPnlCoverage` always states which case this is. (#777)
         */
        grossPnl: costsCaptured ? r2(b.netPnl - costTotal) : null,
        grossPnlCoverage: { withCosts: b.rowsWithCosts, withoutCosts: b.rowsWithoutCosts },
        costs: costsCaptured
          ? {
              // Signed as the broker charged them (costs are negative). Total is the amount that
              // sits INSIDE netPnl, so grossPnl = netPnl - total, exactly.
              commission: r2(b.costCommission),
              swap: r2(b.costSwap),
              fee: r2(b.costFee),
              total: r2(costTotal),
            }
          : null,
        wins: b.wins,
        losses: b.losses,
        flat: b.flat,
        winRate: b.usable ? r2((b.wins / b.usable) * 100) : null,
        avgWin: b.wins ? r2(b.winPnl / b.wins) : null,
        avgLoss: b.losses ? r2(b.lossPnl / b.losses) : null,
        bestTrade: b.best === null ? null : r2(b.best),
        worstTrade: b.worst === null ? null : r2(b.worst),
        medianHoldMinutes: median(b.holdMinutes) === null ? null : Math.round(median(b.holdMinutes)!),
        symbolsTraded: b.symbols.size,
        firstTradeAt: b.firstAt,
        lastTradeAt: b.lastAt,
        inconclusive: b.usable < MIN_SAMPLE_FOR_VERDICT,
      };
    }).sort((a, b) => b.trades - a.trades);

    const usableTotal = perProtocol.reduce((s, p) => s + p.trades, 0);
    const usableWithCosts = perProtocol.reduce((s, p) => s + p.grossPnlCoverage.withCosts, 0);

    // ─────────────────────────────────────────────────────────────────────────────────────
    // DENOMINATION — measured 2026-09-17.
    //
    // Every P&L figure here is in the TRADING ACCOUNT's currency, NOT USD. MEASURED: the bot
    // account on bridge :5000 is GBP (login 10011309743, balance £1,374.57). Verified against a
    // hand-checked trade: GBPUSD 0.01 lot, 136.9 pips, exit 1.33866 → gross −$13.69, and
    // −13.69 / 1.33866 = −£10.226 which is the recorded `pnl` of −10.23, to the cent.
    //
    // ⚠️ So do NOT reconcile `pnl` against `(exitPrice - entryPrice) * quantity * contractSize`:
    // that arithmetic yields USD and disagrees by the FX rate (~25% at GBP/USD 1.34). The gap is
    // CURRENCY, not missing cost. Labeling this now, because an unlabelled money figure is exactly
    // the "plausible number" class this endpoint exists to remove.
    // ─────────────────────────────────────────────────────────────────────────────────────
    let accountCurrency: string | null = null;
    try {
      const acct: any = await this.mt5.getAccount();
      accountCurrency = acct?.currency ?? null;
    } catch { /* reported as null below rather than assumed to be USD */ }

    return {
      // ── Data quality FIRST: a reader must see the sample before the numbers. ──
      dataQuality: {
        strategyTradeRows: trades.length,
        quarantined,
        exitUnknown,
        usable: usableTotal,
        excluded: quarantined + exitUnknown,
        // Stated so the exclusions cannot be mistaken for a complete picture.
        note:
          'Quarantined rows (pnlInvalid) and rows with no exit price are EXCLUDED from every figure ' +
          'and counted here. Dropping them silently would overstate performance; including them ' +
          'would fabricate it.',
      },
      /** ⚠️ All money below is in this currency. `null` = could not resolve, NOT USD. */
      denomination: {
        currency: accountCurrency,
        resolved: accountCurrency !== null,
        note:
          'pnl / netPnl / grossPnl / avgWin / avgLoss are in the TRADING ACCOUNT currency. ' +
          'The bot account on bridge :5000 is GBP, so these are NOT dollars — comparing them with ' +
          'USD figures (or with a USD price difference) will be wrong by the FX rate.',
      },
      costs: {
        available: usableWithCosts > 0,
        /** Rows whose cost components are captured, out of all usable rows. */
        coverage: { withCosts: usableWithCosts, usableTotal },
        // ⚠️ NOT zero when absent — UNMEASURED. A 0 here would be the exact fabrication this
        // endpoint exists to prevent, and on 0.01-lot FX a few pence of spread decides viability.
        reason: usableWithCosts > 0
          ? 'Persisted per trade from the CLOSING DEALS at finalise time (commission, swap, fee). ' +
            'netPnl already contains them; grossPnl is served per protocol only when every usable ' +
            'row in that protocol carries them. ⚠️ SPREAD IS NOT HERE: commission/swap/fee are deal ' +
            'FIELDS, while spread lives inside the fill prices and cannot be recovered from a deal ' +
            'list — so grossPnl is net PLUS itemised costs, not a spread-free figure.'
          : 'Not yet captured on any usable row: rows closed before 2026-09-22 carry NULL costs. ' +
            'The bridge returns commission/swap/fee on closing deals and position-sync now ' +
            'persists them — coverage grows with each close. grossPnl is null until then; it is ' +
            'explicitly NOT equal to netPnl by definition.',
      },
      threshold: { minSampleForVerdict: MIN_SAMPLE_FOR_VERDICT },
      /**
       * Which resolution path each trade took, and what could not be resolved at all.
       * `unresolvedIds` is deliberately a LIST of the raw values: `unattributed` on its own is a
       * plausible-looking number that hides a broken join, which is exactly how the first version
       * of this endpoint reported 0 of 26 and looked healthy.
       */
      attribution: {
        resolvedByPath: resolvedVia,
        // Counts only usable trades (the resolver runs after the exclusion guards).
        unresolvedCount: (resolvedVia['unresolved'] || 0) + (resolvedVia['bot_without_protocol'] || 0),
        unresolvedIds: [...unresolvedIds].slice(0, 25),
        lookupFailures,
        note:
          'Attribution is via trading_strategy.id (the bot), NOT scoring_strategy.id — the column ' +
          "is named scoringStrategyId but measured 0/31 matches against scoring_strategy. See the " +
          'resolver comment in trade-history.controller.ts.',
      },
      protocols: perProtocol,
    };
  }

  // ── Swap Cost Calculator ──────────────────────────────

  @Get('swap-forecast')
  async swapForecast(
    @Query('symbol') symbol: string,
    @Query('volume') volume?: string,
    @Query('direction') direction?: string,
  ) {
    const vol = volume ? parseFloat(volume) : 0.1;
    const dir = (direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' as const : 'BUY' as const;
    if (!symbol) return { error: 'symbol query parameter is required' };
    const forecast = await this.swapCost.forecastSwap(symbol, vol, dir);
    if (!forecast) return { error: `Could not fetch swap rates for ${symbol}. Is MT5 bridge running?` };
    return forecast;
  }

  @Get('swap-rates')
  async swapRates(@Query('symbol') symbol: string) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const rates = await this.swapCost.getSwapRates(symbol);
    if (!rates) return { error: `Could not fetch swap rates for ${symbol}. Is MT5 bridge running?` };
    return {
      ...rates,
      interpretation: {
        swapLong: rates.swapLong < 0
          ? `Long charged ${Math.abs(rates.swapLong)} pts/day`
          : `Long credited ${rates.swapLong} pts/day`,
        swapShort: rates.swapShort < 0
          ? `Short charged ${Math.abs(rates.swapShort)} pts/day`
          : `Short credited ${rates.swapShort} pts/day`,
      },
    };
  }

  // ── Weekend Defense ──────────────────────────────────

  @Get('weekend-checklist')
  async weekendChecklist() {
    try {
      const mt5 = this.mt5 as any;
      const posData = await mt5.getPositions().catch(() => []);
      const positions = Array.isArray(posData) ? posData : [];

      if (positions.length === 0) {
        return {
          generatedAt: new Date().toISOString(),
          dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getUTCDay()],
          isFriday: new Date().getUTCDay() === 5,
          positions: [],
          totalExposure: 0,
          totalSwapCostTonight: 0,
          totalGapRisk: 0,
          summary: { holdCount: 0, reduceCount: 0, closeCount: 0, totalPositions: 0 },
          nextMarketOpen: new Date().getUTCDay() === 5 ? 'Monday 00:00 GMT' : null,
          message: 'No open positions — weekend is clear.',
        };
      }

      // ⚠️ Pass `type` through as `side` — it is `number | 'buy' | 'sell'` and the bridge sends the
      // STRING form. `buildChecklist` normalises it with `normalizeSide()`. Never compare it to 0:
      // that is the #869 Finding B defect, which reported every long position as SELL.
      return this.weekendDefense.buildChecklist(positions.map((p: any) => ({
        symbol: p.symbol,
        ticket: p.ticket,
        side: p.type ?? p.side,
        volume: p.volume ?? p.quantity ?? 0,
        openPrice: p.price_open ?? p.avgPrice ?? 0,
        currentPrice: p.price_current ?? p.currentPrice ?? 0,
        profit: p.profit ?? p.pnl ?? 0,
        swap: p.swap ?? 0,
        // Present on MT5 positions since 2026-09-18 (#865). Without it the service reports
        // `not-money` rather than returning a ratio as though it were a currency amount.
        contractSize: p.contractSize ?? null,
      })));
    } catch (err) {
      return { error: `Failed to build weekend checklist: ${(err as Error).message}` };
    }
  }

  /**
   * GET /api/trading/stop-adjustments — query SL/TP adjustment history.
   * ?symbol=XAUUSD&tradeTicket=123&limit=20
   */
  @Get('stop-adjustments')
  async getStopAdjustments(
    @Query('symbol') symbol?: string,
    @Query('tradeTicket') tradeTicket?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.prisma.isAvailable) return { adjustments: [], message: 'Database unavailable' };
    const take = Math.min(parseInt(limit || '20', 10) || 20, 100);
    try {
      const where: any = {};
      if (symbol) where.symbol = symbol.toUpperCase();
      if (tradeTicket) where.tradeTicket = tradeTicket;

      const adjustments = await (this.prisma as any).stopAdjustment.findMany({
        where, orderBy: { adjustedAt: 'desc' }, take,
      });

      return {
        adjustments: adjustments.map((a: any) => ({
          id: a.id,
          tradeTicket: a.tradeTicket,
          symbol: a.symbol,
          oldSl: a.oldSl, newSl: a.newSl,
          oldTp: a.oldTp, newTp: a.newTp,
          reason: a.reason,
          directiveScores: a.directiveScores,
          adjustedAt: a.adjustedAt,
        })),
        total: adjustments.length,
      };
    } catch (err) {
      return { adjustments: [], error: (err as Error).message };
    }
  }

  /**
   * GET /api/trading/portfolio-snapshots — query portfolio snapshots.
   * ?type=trade&limit=10
   */
  @Get('portfolio-snapshots')
  async getPortfolioSnapshots(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.prisma.isAvailable) return { snapshots: [], message: 'Database unavailable' };
    const take = Math.min(parseInt(limit || '10', 10) || 10, 50);
    try {
      const where: any = {};
      if (type) where.snapshotType = type;

      const snapshots = await (this.prisma as any).portfolioSnapshot.findMany({
        where, orderBy: { takenAt: 'desc' }, take,
        include: { positions: true },
      });

      return {
        snapshots: snapshots.map((s: any) => ({
          id: s.id,
          type: s.snapshotType,
          totalValue: s.totalValue,
          totalPnl: s.totalPnl,
          totalPnlPct: s.totalPnlPct,
          positionCount: s.positionCount,
          cash: s.cash,
          providerSummary: s.providerSummary,
          takenAt: s.takenAt,
          positions: s.positions?.map((p: any) => ({
            symbol: p.symbol,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            pnl: p.pnl,
            pnlPct: p.pnlPct,
          })) || [],
        })),
        total: snapshots.length,
      };
    } catch (err) {
      return { snapshots: [], error: (err as Error).message };
    }
  }
}
