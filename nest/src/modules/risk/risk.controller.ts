/**
 * Risk Controller
 * ================
 * Exposes RiskService + TradingGatesService as a unified risk dashboard.
 */

import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService, PortfolioRisk, PositionSizeType, StopLossType, TakeProfitType } from './risk.service';
import { buildRiskProfile } from './risk-profile-rules';
import {
  resolveIntent,
  summariseExposure,
  overrideKey,
  parseIntent,
  describeIntent,
  POSITION_INTENTS,
  GAP_EXPOSED_INTENTS,
  PROVIDER_DEFAULT_INTENT,
  type PositionIntent,
} from './position-intent';
import { TradingGatesService, GateConfig } from '../trading-gates/trading-gates.service';
import { MonteCarloService } from './monte-carlo.service';
import { PrismaService } from '../../database/prisma.service';
// #778 — the ONE definition of broker-maintained vs cached-import position rows.
import { POSITION_LIVE_WINDOW_MS } from '../../common/utils/position-freshness';
// ⚠️ #954 — ONE drawdown definition. The implementation moved to common/trading/drawdown.ts when
// this file and trading/bot-performance.service.ts were found to disagree about whether a
// percentage is stated at all. Do not reintroduce a local copy.
import { computeDrawdownDetail } from '../../common/trading/drawdown';
import { WeekendGapRiskService } from './weekend-gap-risk.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

@ApiTags('risk')
@Controller('risk')
export class RiskController {
  private readonly logger = new Logger(RiskController.name);

  constructor(
    private readonly riskService: RiskService,
    private readonly tradingGates: TradingGatesService,
    private readonly monteCarlo: MonteCarloService,
    private readonly prisma: PrismaService,
    private readonly weekendGapRisk: WeekendGapRiskService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * readIntentOverrides() — every recorded exception, as the map `position-intent.ts` expects.
   *
   * ⚠️ Returns the rows AND an error, rather than swallowing one into an empty map. An empty map
   * silently means "no exceptions", which for a `trading212` holding resolves to `long-term` — so a
   * failed read would EXEMPT the holdings from risk checks while looking like a healthy answer.
   * Callers must surface `error`; see `getPositionIntents()`.
   */
  private async readIntentOverrides(): Promise<{ map: Map<string, PositionIntent>; error?: string }> {
    try {
      const rows = await this.prisma.positionIntentSetting.findMany();
      const map = new Map<string, PositionIntent>();
      for (const r of rows) {
        const parsed = parseIntent(r.intent);
        if (parsed) map.set(overrideKey(r.provider, r.symbol), parsed);
        else this.logger.warn(`position_intent ${r.provider}/${r.symbol} has unreadable intent "${r.intent}"`);
      }
      return { map };
    } catch (e: any) {
      return { map: new Map(), error: e?.message ?? 'intent override read failed' };
    }
  }

  /**
   * GET /api/risk/position-intents
   *
   * The answer to "what kind of position is this, and does a weekend gap endanger it?" — one row
   * per position, with the intent, WHERE that intent came from, and whether the owner is needed.
   *
   * WHY IT EXISTS: the weekend-gap alert reported 26 positions to "consider flattening" when 21
   * were deliberate long-term holdings. The alert could not tell the difference because nothing
   * recorded it. This endpoint is the surface where the difference is VISIBLE and SETTABLE, so the
   * default is never the only answer.
   *
   * `needsDecision` is the owner's own request: *"if the app itself is missing values it should ask
   * me"*. A row appears there when neither an override nor a provider default can characterise it —
   * the app asks rather than guessing in either direction.
   */
  @Get('position-intents')
  @ApiOperation({ summary: 'Per-position trading intent, its source, and whether a decision is needed' })
  async getPositionIntents(@Query('provider') provider?: string, @Query('symbol') symbol?: string) {
    const { map, error } = await this.readIntentOverrides();
    const where: any = {};
    if (provider) where.provider = provider;
    if (symbol) where.symbol = symbol;

    const positions = await this.prisma.position.findMany({ where });

    const rows = positions.map((p) => {
      const { intent, source } = resolveIntent({ symbol: p.symbol, provider: p.provider }, map);
      return {
        provider: p.provider,
        symbol: p.symbol,
        side: p.side ?? null,
        quantity: p.quantity,
        pnl: p.pnl ?? null,
        intent,
        intentSource: source,
        gapExposed: GAP_EXPOSED_INTENTS.includes(intent),
        needsDecision: intent === 'unclassified',
        label: describeIntent(intent),
      };
    });

    const { exposed, held, needingDecision } = summariseExposure(
      positions.map((p) => ({ symbol: p.symbol, provider: p.provider })), map,
    );

    return {
      positions: rows,
      totals: {
        all: rows.length,
        gapExposed: exposed.length,
        heldLongTerm: held.length,
        needingDecision: needingDecision.length,
      },
      vocabulary: {
        intents: POSITION_INTENTS,
        gapExposedIntents: GAP_EXPOSED_INTENTS,
        providerDefaults: PROVIDER_DEFAULT_INTENT,
      },
      // ⚠️ Present only when the override read FAILED. Forwarded so a stale or empty `totals` is
      // never mistaken for a healthy "nothing to report".
      ...(error ? { error } : {}),
    };
  }

  /**
   * PUT /api/risk/position-intents/:provider/:symbol
   *
   * Records the owner's answer for one position. Body: `{ intent, note? }`.
   *
   * This is the other half of the alert fix — the alert asks, this is where the answer is kept. Once
   * set, the position resolves by OVERRIDE (reported as `intentSource: 'override'`) rather than by
   * provider inference, so the two are always distinguishable afterwards.
   */
  @Put('position-intents/:provider/:symbol')
  @ApiOperation({ summary: 'Set the trading intent for one provider+symbol position' })
  async setPositionIntent(
    @Param('provider') provider: string,
    @Param('symbol') symbol: string,
    @Body() body: { intent?: string; note?: string },
  ) {
    const intent = parseIntent(body?.intent);
    if (!intent) {
      // Refuse rather than coerce. Defaulting an unrecognised intent to `long-term` would silence
      // risk checks on a position the owner was trying to flag — the worst possible direction.
      return {
        ok: false,
        error: `unknown intent "${body?.intent}" — expected one of: ${POSITION_INTENTS.join(', ')}`,
        accepted: POSITION_INTENTS,
      };
    }

    const row = await this.prisma.positionIntentSetting.upsert({
      where: { provider_symbol: { provider, symbol } },
      create: { provider, symbol, intent, note: body?.note ?? null },
      // ⚠️ `intent` is in the update clause, not only the create. An upsert that omits a field
      // cannot REPAIR a wrong value — it would look like a successful change while the old intent
      // stayed in force. (Same defect class as the seeders in database-seed-discipline.)
      update: { intent, note: body?.note ?? null },
    });

    this.logger.log(`position intent set: ${provider}/${symbol} -> ${intent}`);
    return {
      ok: true,
      provider: row.provider,
      symbol: row.symbol,
      intent: row.intent,
      label: describeIntent(intent),
      gapExposed: GAP_EXPOSED_INTENTS.includes(intent),
    };
  }

  /**
   * readRiskCapValues() — the three settings the `PortfolioRisk` caps are built from.
   *
   * One helper for three call sites (GET /overview, GET /limits, POST /calculate-position). Each of
   * those used to hand-write its own six-key literal, which is how `0.25` came to exist in five
   * copies across four files (#865). Now there is one builder and one source per value.
   */
  private async readRiskCapValues() {
    return {
      maxOpenPositions: await this.settings.get<number>('risk.maxOpenPositions'),
      maxPerSymbol: await this.settings.get<number>('risk.maxPerSymbol'),
      maxDrawdown: await this.settings.get<number>('risk.maxDrawdown'),
      // Live since #900 (2026-09-19) — declared since the beginning with no reader anywhere.
      maxPortfolioRisk: await this.settings.get<number>('risk.maxPortfolioRisk'),
    };
  }

  /**
   * GET /api/risk/overview
   *
   * Unified risk dashboard: portfolio health + gate config + recent checks.
   */
  @Get('overview')
  async getOverview() {
    const [health, gateConfig] = await Promise.all([
      this.getPortfolioHealthReal(),
      Promise.resolve(this.tradingGates.getConfig()),
    ]);

    // Build gate status from config
    const gateStatus = {
      enabled: gateConfig.enabled,
      gates: {
        threshold: {
          active: true,
          minScore: gateConfig.thresholds.minScore,
          minConfidence: gateConfig.thresholds.minConfidence,
          longThreshold: gateConfig.thresholds.longThreshold,
          shortThreshold: gateConfig.thresholds.shortThreshold,
        },
        scope: {
          active: true,
          whitelist: gateConfig.scope.symbolWhitelist,
          blacklist: gateConfig.scope.symbolBlacklist,
          marketTypes: gateConfig.scope.marketTypes,
          minPrice: gateConfig.scope.minPrice,
          minAvgVolume: gateConfig.scope.minAvgVolume,
          tradingHours: gateConfig.scope.tradingHours,
        },
        position: {
          active: true,
          maxPositions: gateConfig.positions.maxPositions,
          cooldownHours: gateConfig.positions.cooldownHours,
          allowAveraging: gateConfig.positions.allowAveraging,
          closeOppositeSignal: gateConfig.positions.closeOppositeSignal,
        },
      },
    };

    // Risk limits — built from the SAME settings the live gate reads, so this dashboard cannot
    // disagree with the engine that refuses the order.
    //
    // ⚠️ This block used to spell all six caps by hand AND take `maxPositions` from the
    // TRADING-GATES config, while GET /api/trading/strategies/risk-limits takes it from
    // `risk.maxOpenPositions`. Two endpoints therefore reported a DIFFERENT max-positions cap — and
    // the one reported here came from a config nothing on the live path consults. (#865)
    const limits = await buildRiskProfile(await this.readRiskCapValues());

    // Determine circuit breaker state
    const circuitBreaker = this.evaluateCircuitBreaker(health, gateConfig, limits);

    return {
      generatedAt: new Date().toISOString(),
      portfolioHealth: health,
      riskLimits: limits,
      gateConfig,
      gateStatus,
      circuitBreaker,
    };
  }

  private evaluateCircuitBreaker(
    health: any,
    config: GateConfig,
    limits: any,
  ) {
    const triggers: string[] = [];

    // ── Drawdown (#950) ────────────────────────────────────────────────────────
    // ⚠️ UNIT: `health.drawdown` is a PERCENT; `risk.maxDrawdown` is a FRACTION (0.25 = 25%).
    // The old line was `health.drawdown > config.thresholds.maxDrawdown` — 1557.8 > 0.25 is true
    // on every call, so this breaker was PERMANENTLY TRIPPED and its "Exceeded max drawdown"
    // trigger told the reader nothing. Convert once, here, from the setting (one owner).
    const capPct = Number(limits?.maxDrawdown ?? 0.25) * 100;
    const ddPct = health.drawdown;
    if (typeof ddPct === 'number' && ddPct > capPct) {
      const cur = health.drawdownDetail?.currency;
      triggers.push(
        `Drawdown ${ddPct.toFixed(1)}% of peak > risk.maxDrawdown (${capPct}%)` +
          (typeof cur === 'number' ? ` — peak-to-trough ${cur.toFixed(2)} P&L units` : ''),
      );
    }

    // ── Position cap (#852) ────────────────────────────────────────────────────
    // ⚠️ UNIT HISTORY: this health object once exposed the position COUNT under the name
    // `totalExposure`, and the line here compared it against 80 under the label "Exposure >
    // 80%" — a count wearing a percentage's name, unreachable by 16×. `totalExposure` is gone
    // from this payload (the weekend checklist keeps its notional meaning under the same name,
    // disambiguated by `totalExposureBasis` there). Here the value is `positionCount`.
    //
    // BOUNDARY (settled #852): EXCLUSIVE — fires when the enforced cap has been BREACHED
    // (count > cap), not when the book is merely full. Exactly-at-cap is the normal steady
    // state (the cap gate refuses new entries); a breaker that reads TRIPPED through normal
    // operation is the alarm-fatigue defect class from #950.
    const maxPos = Number(limits?.maxPositions ?? 5);
    const capBreach = positionCapBreach(health.positionCount, maxPos);
    if (capBreach) triggers.push(capBreach);

    const state = triggers.length > 0 ? 'TRIPPED' : 'READY';
    return {
      state,
      triggers,
      autoResetMinutes: state === 'TRIPPED' ? 60 : null,
      lastChecked: new Date().toISOString(),
    };
  }

  private async getPortfolioHealthReal() {  try {
      // ── #778 — exposure figures cover BROKER-MAINTAINED positions only ──
      // The position table also holds cached portfolio-import rows (a one-off Trading 212
      // import, quotes frozen at import time). Counting them here reported “33 positions,
      // −1,021.77“ — the frozen rows outweighing the live book — and nothing errored. They are
      // still REPORTED (cachedImportPositions below), never silently dropped.
      const liveCutoff = new Date(Date.now() - POSITION_LIVE_WINDOW_MS);
      const cachedWhere = { OR: [{ lastQuotedAt: { lt: liveCutoff } }, { lastQuotedAt: null }] };
      const positionCount = await this.prisma.position.count({ where: { lastQuotedAt: { gte: liveCutoff } } }).catch(() => 0);
      const pnlAgg = await this.prisma.position.aggregate({
        _sum: { pnl: true },
        where: { lastQuotedAt: { gte: liveCutoff } },
      }).catch(() => ({ _sum: { pnl: 0 } }));
      const totalPnlFromPositions = (pnlAgg as any)?._sum?.pnl ?? 0;
      const cachedCount = await this.prisma.position.count({ where: cachedWhere }).catch(() => 0);
      const cachedPnlAgg = await this.prisma.position.aggregate({
        _sum: { pnl: true },
        where: cachedWhere,
      }).catch(() => ({ _sum: { pnl: 0 } }));
      const cachedPnl = (cachedPnlAgg as any)?._sum?.pnl ?? 0;

      // Check recent trades for P&L
      const recentTrades: any[] = await this.prisma.trade.findMany({
        orderBy: { closedAt: 'desc' },
        take: 50,
        select: { pnl: true, closedAt: true },
      }).catch(() => [] as any[]);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayTrades = recentTrades.filter((t: any) => t.closedAt && new Date(t.closedAt) >= todayStart);
      const dailyPnl = todayTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);
      const tradeTotalPnl = recentTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);

      // Drawdown, DEFINED (#950): peak-to-trough of the cumulative realised P&L over this window.
      const dd = computeDrawdownDetail(recentTrades);

      // Risk warnings — thresholds come from the ONE owner (`risk.maxDrawdown`, a fraction).
      // The old 12%/20% literals were invented against a ratio with no defined base.
      const warnings: string[] = [];
      const markPct = Number((await this.readRiskCapValues()).maxDrawdown ?? 0.25) * 100;
      const criticalPct = markPct * 2; // tier policy: 'twice the cap' — stated, not hidden
      if (dd.pctOfPeak === null && dd.currency > 0) {
        // TWO different causes produce a null ratio, and they are NOT the same claim (#954):
        //   (a) peak <= 0 — the window never rose above zero; there is no denominator at all.
        //   (b) peak > 0 but currency > peak — a fall larger than the peak itself; a percentage of
        //       it would exceed 100%, which means the denominator is not a capital base.
        // Reporting (b) as "never rose above zero" is a wrong claim about real data — measured
        // live 2026-09-23 the text said exactly that while `peak` was +3.83.
        if (dd.peak > 0) {
          warnings.push(
            `Cumulative P&L is ${dd.currency.toFixed(2)} below its peak of ${dd.peak.toFixed(2)} over the ` +
              `last ${dd.trades} closed trades — the fall exceeds the peak itself, so a percentage of it ` +
              `would exceed 100% and is not stated (#954). The currency figure is the true drawdown.`,
          );
        } else {
          warnings.push(
            `Cumulative P&L is ${dd.currency.toFixed(2)} below its peak over the last ${dd.trades} closed ` +
              `trades — no percentage: the window never rose above zero, so risk.maxDrawdown cannot be applied`,
          );
        }
      } else if (dd.pctOfPeak !== null && dd.pctOfPeak > criticalPct) {
        warnings.push(
          `Peak-to-trough over the last ${dd.trades} closed trades: ${dd.pctOfPeak.toFixed(1)}% of peak ` +
            `(${dd.peak.toFixed(2)}) = ${dd.currency.toFixed(2)} given back — CRITICAL (> ${criticalPct}%)`,
        );
      } else if (dd.pctOfPeak !== null && dd.pctOfPeak > markPct) {
        warnings.push(
          `Peak-to-trough over the last ${dd.trades} closed trades: ${dd.pctOfPeak.toFixed(1)}% of peak ` +
            `(${dd.peak.toFixed(2)}) = ${dd.currency.toFixed(2)} given back — exceeds risk.maxDrawdown (${markPct}%)`,
        );
      }
      if (positionCount === 0) warnings.push('No tracked positions found');
      if (dailyPnl < -500) warnings.push('Daily P&L below -$500');
      if (cachedCount > 0) {
        warnings.push(`${cachedCount} cached portfolio-import position(s) excluded from exposure (not broker-maintained; #778)`);
      }

      return {
        totalPositionPnl: totalPnlFromPositions,
        tradeTotalPnl,
        /**
         * DEFN (#950): peak-to-trough of the cumulative P&L over the last N closed trades, as a
         * % of the peak. `null` when the window never rose above zero — the ratio has no meaning
         * then, and 0 would read as 'no drawdown' ("fine" vs "cannot judge"). The always-true
         * figure is `drawdownDetail.currency`.
         */
        drawdown: dd.pctOfPeak,
        drawdownDetail: dd,
        dailyPnl,
        totalPnl: totalPnlFromPositions,
        positionCount,
        /** #778 — kept VISIBLE: cached import rows and their stale P&L, excluded from the figures above. */
        cachedImportPositions: { count: cachedCount, pnl: Math.round(cachedPnl * 100) / 100 },
        riskWarnings: warnings,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(`Portfolio health query failed: ${(err as Error).message}`);
      return {
        totalPositionPnl: 0, tradeTotalPnl: 0,
        drawdown: null, drawdownDetail: null,
        dailyPnl: 0,
        totalPnl: 0, positionCount: 0, riskWarnings: ['Unable to query portfolio data'],
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('calculate-position')
  @ApiOperation({ summary: 'Calculate suggested position size, SL, and TP' })
  async calculatePosition(
    @Body() body: {
      symbol: string;
      score: number;
      confidence: number;
      strategyId?: string;
      entryPrice: number;
      portfolioValue: number;
      positionType?: PositionSizeType;
      stopLossType?: StopLossType;
      takeProfitType?: TakeProfitType;
      atr?: number;
      swingLow?: number;
      winRate?: number;
      avgWinLossRatio?: number;
    },
  ) {
    // Built from settings, not literals: this endpoint is reachable from the UI, so a hardcoded cap
    // here would let a manual sizing request disagree with the automation loop's own limits. (#865)
    const riskProfile: PortfolioRisk = await buildRiskProfile(await this.readRiskCapValues());

    const slPrice = this.riskService.calculateStopLoss(
      body.entryPrice,
      body.stopLossType || 'fixed-pct',
      body.stopLossType === 'atr-multiple' ? 2 : 0.05,
      body.atr,
      body.swingLow,
    );

    const tpResult = this.riskService.calculateTakeProfit(
      body.entryPrice,
      slPrice,
      body.takeProfitType || 'risk-reward',
      2,
    );

    const positionSize = this.riskService.calculatePositionSize(
      body.positionType || 'risk-based',
      1000,
      body.portfolioValue,
      body.entryPrice,
      slPrice,
      riskProfile,
      body.winRate,
      body.avgWinLossRatio,
    );

    return {
      symbol: body.symbol,
      score: body.score,
      confidence: body.confidence,
      suggestedShares: positionSize.shares,
      capitalRequired: positionSize.capitalRequired,
      stopLossPrice: slPrice,
      takeProfitPrice: typeof tpResult === 'number' ? tpResult : tpResult.targets,
      riskAmount: positionSize.maxLoss,
      sizingMethod: positionSize.sizingMethod,
    };
  }

  @Get('portfolio-health')
  @ApiOperation({ summary: 'Get portfolio health overview' })
  async getPortfolioHealth() {
    return this.getPortfolioHealthReal();
  }

  @Get('limits')
  @ApiOperation({ summary: 'Get current risk limits configuration' })
  async getLimits() {
    // ⚠️ `defaultValue` in settings-registry.ts is the DECLARED default; this returns the EFFECTIVE
    // value (a DB override wins). Those two differing is normal and is why the response is now read
    // live rather than echoed from a literal. Provenance per value: GET /api/system/settings/registry
    return buildRiskProfile(await this.readRiskCapValues());
  }

  // ── Weekend Gap Risk ──────────────────────────────────

  @Get('weekend-exposure')
  @ApiOperation({ summary: 'Project weekend gap risk for a position based on historical gaps' })
  async weekendExposure(
    @Query('symbol') symbol: string,
    @Query('direction') direction?: string,
    @Query('value') value?: string,
  ) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const dir = (direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' as const : 'BUY' as const;
    const posValue = value ? parseFloat(value) : 1000;

    const exposure = await this.weekendGapRisk.projectExposure(symbol, dir, posValue);
    return exposure;
  }

  @Get('weekend-gap-stats')
  @ApiOperation({ summary: 'Historical weekend gap statistics for a symbol' })
  async weekendGapStats(@Query('symbol') symbol: string) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const stats = await this.weekendGapRisk.getGapStats(symbol);
    if (!stats) return { error: `Insufficient data for ${symbol} gap analysis` };
    return stats;
  }
}

/**
 * DrawdownDetail / computeDrawdownDetail live in `common/trading/drawdown.ts` (#954) — one
 * definition, two callers (this controller and bot-performance). Do not reintroduce a local copy:
 * the two implementations once disagreed about whether a percentage is stated at all.
 */

/**
 * positionCapBreach() — the position-cap trigger for the risk circuit breaker (#852).
 * ==================================================================================================
 * Returns the TRIGGER MESSAGE or null, rather than a boolean, so the comparison and the text it
 * produces can never drift apart — and so the boundary is testable without constructing a whole
 * controller (the same extraction pattern as computeDrawdownDetail below).
 *
 * ⚠️ UNIT: `count` is a NUMBER OF POSITIONS; `maxPos` is the same unit (`risk.maxOpenPositions`).
 * The predecessor of this function compared a count against `80` under the label "Exposure >
 * 80%" — the count/notional/percentage collision (#852). If this ever needs to compare money,
 * the money needs its own function with "notional" in its name.
 *
 * BOUNDARY: EXCLUSIVE (`> cap`). At exactly the cap the book is FULL — the normal steady state,
 * since the cap gate refuses new entries there. The breaker fires when the cap has been BREACHED
 * (e.g. manual entries pushed the book past it), which is the state worth halting on.
 *
 * "Cannot judge" (null/undefined/NaN — a failed count) also returns null: an unreadable value is
 * not a breach, and must never be rendered as one (nor as a clean zero).
 */
export function positionCapBreach(count: number | null | undefined, maxPos: number): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  if (count > maxPos) return `${count} positions > risk.maxOpenPositions (${maxPos})`;
  return null;
}

// computeDrawdownDetail() + DrawdownDetail moved to `common/trading/drawdown.ts` (#954). The
// bounded-ratio rule (null when currency > peak) and the 0-baseline live there, with the canary.
