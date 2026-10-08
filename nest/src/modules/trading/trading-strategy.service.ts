/**
 * TradingStrategyService — STAGE 4 of the META.Stack pipeline.
 * ============================================================
 * ROLE: Receive evaluated decisions and dispatch trades to brokers.
 *       Does NOT compute scores, apply gates, or make decisions —
 *       those all happen upstream in Scoring → AutomationLoop.
 *
 * PIPELINE POSITION:
 *   ScoringService (Stage 1) → AutomationLoop gates+evaluates (Stage 2+3)
 *   → TradingStrategyService.execute() (Stage 4) → Broker (MT5/T212/etc.)
 *
 * CONTRACT:
 *   INPUT:  strategyId + evaluated signal (BUY/SELL/HOLD from AutomationLoop)
 *   OUTPUT: trade placed via broker adapter, recorded to Trade table
 *   NEVER:  computes directive scores, applies risk gates, or decides direction
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Mt5TradingService } from './mt5-trading.service';
import { ConditionDetectorService } from '../directives/condition-detector.service';
// ⚠️ SINGLE SOURCE for the bot strength bar. Do NOT reintroduce a literal here.
//
// This file previously defaulted to `?? 60` (scoring_strategy) and `?? 65` (trading_strategy) —
// both pre-rescale values. The 2026-09-15 rescale divides every percentage by ~6.3, so measured
// `compositePct` now peaks at ~33. A bot created through the API therefore received a bar it
// could NEVER clear: it would appear active, score normally, emit SKIP decisions with a
// plausible reason, and never trade. No error anywhere. See #839, and the guard that now
// enforces this: `nest/scripts/validate-threshold-sources.cjs`.
import { BOT_BAR_DEFAULT } from '../../common/utils/style-thresholds';
// ⚠️ #963 — the canonical definition of "a behavioural field". `NON_BEHAVIOURAL_COLUMNS` is the
// ONLY list of columns that cannot shape a trade, and `BOT_RULES` is the declared field set
// (gated by validate-bot-rules.cjs). A second hand-written list here would drift from both.
import { BOT_RULES, NON_BEHAVIOURAL_COLUMNS } from './bot-rules';
import { resolveEffectiveRole } from '../../common/utils/signal-direction';
import { RiskService } from '../risk/risk.service';
import { buildRiskProfile } from '../risk/risk-profile-rules';
import {
  estimatePositionMargin,
  describeMargin,
  conversionPairsNeeded,
  conversionFor,
  resolveProfitCurrency,
  ASSUMED_CURRENCY_SAFETY_FACTOR,
} from '../../common/trading/position-margin';
// ⚠️ #848 — the peak rule lives in ONE place. An unreadable account value must never seed the
// drawdown peak (a fabricated $10,000 did exactly that and blocked every trade on recovery);
// peak-equity.spec.ts pins the rule and canaries it.
import { nextPeakEquity } from '../../common/trading/peak-equity';
import { NotificationService } from '../notifications/notifications.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
// ⚠️ #905 — the ceiling measurement behind the activation gate. ONE arithmetic basis shared
// with the health audit: a REFUSAL here and an audit finding there can never disagree.
import { ProtocolHealthService } from '../scoring/protocol-health.service';
// ⚠️ A/B copy (2026-09-22): ProtocolDbService owns the protocol's structure (groups, entries,
// symbol wiring), so the deep copy lives THERE rather than here — one implementation, not two.
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { TcsNoticeException } from '../../common/notices/tcs-notice.exception';
import { MarketBar } from '../directives/interfaces/directive.interface';
// ⚠️ The CANONICAL session parser. Used to NORMALISE `sessionWindow` for display, because the
// column is stored in two forms (`london` and `["london"]`) meaning the same gate. Do not
// hand-roll a second parser — it would drift from the one the engine enforces with.
import { parseSessionWindow } from './session-window';
// ⚠️ #849 (2026-09-17): the three risk caps below were `process.env.MT5_MAX_*`. They are now declared
// settings read through this resolver — see settings-registry.ts for why, and for the carried-over defaults.
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

export interface StrategySummary {
  id: string;
  name: string;
  version?: string | null;
  protocolId: string | null;
  shortProtocolId?: string | null;
  /** #703-era protocol subscriptions (2026-08-31) — the multi-protocol signal sources. */
  protocols?: Array<{ id: string; protocolId: string; role: string }>;
  symbol: string;
  timeframe: string;
  mode: string;
  active: boolean;
  brokerId?: string;
  /**
   * #1018 — the bot's MT5 MAGIC: the position's identity for LIFE.
   *
   * ⚠️ THIS FIELD EXISTS HERE BECAUSE THIS METHOD IS AN EXPLICIT FIELD LIST, AND THAT IS DANGEROUS.
   * `findAll()` does not return the Prisma row; it maps one field at a time. So a column that is
   * SEEDED, ACCEPTED by the bridge and FORWARDED by the adapter is still lost if it is not named
   * here — and nothing fails.
   *
   * MEASURED 2026-09-29. `magic` was omitted. Consequently `strategy.magic` was ALWAYS `undefined`,
   * `automation-loop.service.ts` passed `undefined`, `mt5.adapter.ts` omitted it (`...(params.magic
   * != null ? ... : {})`), and the bridge fell back to `DEFAULT_MAGIC = 234000` — which means "no bot
   * attributed". Every live position carried 234000 and `trade.magic` was NULL on every open row.
   * THREE LAYERS WERE CORRECT AND ONE HAND-WRITTEN LIST DROPPED THE VALUE.
   *
   * The cost is not theoretical: the order comment became the ONLY owner key, and MT5 mutates it
   * (truncation, and it strips parentheses). `XAUUSD #152698800224` on the `Gold Swing 1H (copy)`
   * bot arrived as `TCS Gold Swing 1H copy`, resolved to NO bot, and was left unmanaged for 341
   * consecutive ticks with a warning nobody reading the canonical log could see.
   *
   * Guarded by `bot-summary-mapping.spec.ts` — it fails when a column the order path depends on is
   * added to the schema but not to this list.
   */
  magic?: number | null;
  minComposite?: number;
  baseSize?: number | null;
  slPct?: number | null;
  tpPct?: number | null;
  cooldownMinutes?: number;
  /**
   * Session gate (2026-09-10) — declared market session tags this bot may act
   * in ('asian' | 'london' | 'us'). null/empty = ungated. See session-window.ts.
   */
  sessionWindow?: string | null;
  /**
   * The session gate NORMALISED to canonical tags, for DISPLAY.
   *
   * ⚠️ `sessionWindow` is stored in two forms — measured 2026-09-18: some bots hold a bare
   * `london`, others hold `["london"]`. They mean the SAME gate. Rendering the raw column would
   * therefore show two rows as different when they are identical, which is the inverse of the bug
   * this table exists to prevent. Normalised here with the CANONICAL `parseSessionWindow()`, so the
   * display cannot drift from what the engine actually enforces.
   *
   * Empty array = ungated (a real declared state: the bot may act any time), NOT missing data.
   */
  sessionTags?: string[];
  maxPositions?: number;
  /**
   * Position time-stop limit in HOURS (#773). null = no limit.
   *
   * ⚠️ MUST be carried on the summary. It lives on the `trading_strategy` row as
   * `maxHoldHours`, but `PositionTimeStopService` reads it off `findAll()` — so omitting
   * it here makes the limit unreadable and the time-stop silently no-ops, which is the
   * exact failure mode this field exists to fix.
   */
  maxHoldHours?: number | null;
  /**
   * EXIT-side session boundary in UTC `'HH:MM'` (#928). null = no boundary.
   *
   * ⚠️ MUST be carried on the summary, for exactly the reason `maxHoldHours` above must be:
   * `PositionTimeStopService` reads it off `findAll()`, so omitting it here makes the boundary
   * unreadable and the exit gate silently no-ops — while the UI still shows the value the
   * operator typed. That is a declared-but-unenforced field, which is the defect #870/#966 exist
   * to prevent.
   */
  exitBeforeUtc?: string | null;
  /** #344 pyramid averaging — moved here from ScoringStrategy (2026-08-27). */
  maxPyramidTiers?: number;
  /**
   * THE MARKET SCOPE of this strategy — the watchlist(s) its protocol is bound to.
   *
   * WHY THIS EXISTS: the owner defines a strategy as protocol + market + bot treatment, and the
   * Trading Strategies table needs to show the market as "Watchlist / Symbol" — a genuine
   * watchlist when one is used, or a single symbol when a one-symbol treatment is deliberate
   * (*"we apply single symbol treatment when we do not want to form a watchlist for one symbol"*).
   *
   * ⚠️ NOT derivable in the browser. `strategy_protocol.protocolId` holds a protocol SLUG while
   * `watchlist.protocolId` holds the protocol UUID, and no endpoint exposes both — the `protocol`
   * table is the only bridge. Hence the join lives here.
   *
   * Empty array = no watchlist bound to this strategy's protocol. That is a FINDING (a single-symbol
   * treatment), not missing data, so it is returned as `[]` rather than omitted.
   */
  watchlists?: Array<{ name: string; symbolCount: number }>;
  lastEvaluatedAt: string | null;
  lastSignal: string | null;
  lastComposite: number | null;
  evaluationCount: number;
  /** Profit/runtime ratio: total P&L / days active. null if no trades. */
  profitRatio: number | null;
  /** Total realized P&L across all trades for this strategy. */
  totalPnl: number | null;
  /** Days since first trade (or 1 if only one day of trades). */
  daysActive: number | null;
}

@Injectable()
export class TradingStrategyService {
  private readonly logger = new Logger(TradingStrategyService.name);
  private lastTradeTime = new Map<string, Date>(); // strategyId → last trade time
  /** Monotonic peak equity — only increases, so drawdown is measured against a real peak. */
  private peakEquity: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5TradingService,
    private readonly conditionDetector: ConditionDetectorService,
    private readonly riskService: RiskService,
    private readonly notificationService: NotificationService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly settings: SettingsResolverService,
    private readonly protocolHealth: ProtocolHealthService,
    private readonly protocolDb: ProtocolDbService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────

  // #712 — strategy-owned protocol subscriptions.
  async getProtocolSubscriptions(strategyId: string) {
    return (this.prisma as any).strategyProtocol
      .findMany({ where: { strategyId }, orderBy: { sortOrder: 'asc' } })
      .catch(() => []);
  }

  /** #714 — pending signal queue for one trading bot (strongest first). */
  async getSignalQueue(strategyId: string) {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, strategyId, symbol, protocolId, direction, \`signal\`,
                CAST(compositePct AS SIGNED) AS compositePct,
                CAST(signalPct AS SIGNED) AS signalPct,
                CAST(opportunityPct AS SIGNED) AS opportunityPct,
                CAST(combinedStrength AS SIGNED) AS combinedStrength,
                scoreId, status, createdAt, updatedAt
         FROM strategy_signal_queue
         WHERE strategyId = ? AND status = 'pending'
         ORDER BY COALESCE(combinedStrength, 0) DESC, createdAt ASC`,
        strategyId,
      );
      return rows.map((r: any) => ({
        ...r,
        compositePct: r.compositePct == null ? null : Number(r.compositePct),
        signalPct: r.signalPct == null ? null : Number(r.signalPct),
        opportunityPct: r.opportunityPct == null ? null : Number(r.opportunityPct),
        combinedStrength: r.combinedStrength == null ? null : Number(r.combinedStrength),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt ?? ''),
      }));
    } catch {
      return [];
    }
  }

  /**
   * #714 Stage 2 — all pending queue entries across every trading bot,
   * joined with strategy info for the Strategy Monitor queue view.
   */
  async getAllQueues() {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT q.id, q.strategyId, ts.name AS strategyName, ts.symbol AS strategySymbol,
                ts.active AS strategyActive, ts.mode AS strategyMode, ts.brokerId,
                q.symbol, q.protocolId, q.direction, q.\`signal\`,
                CAST(q.compositePct AS SIGNED) AS compositePct,
                CAST(q.signalPct AS SIGNED) AS signalPct,
                CAST(q.opportunityPct AS SIGNED) AS opportunityPct,
                CAST(q.combinedStrength AS SIGNED) AS combinedStrength,
                q.scoreId, q.status, q.createdAt, q.updatedAt
         FROM strategy_signal_queue q
         JOIN trading_strategy ts ON ts.id = q.strategyId
         WHERE q.status = 'pending'
         ORDER BY q.createdAt DESC`,
      );
      const num = (v: unknown) => (v == null ? null : Number(v));
      return rows.map((r: any) => ({
        ...r,
        compositePct: num(r.compositePct),
        signalPct: num(r.signalPct),
        opportunityPct: num(r.opportunityPct),
        combinedStrength: num(r.combinedStrength),
        strategyActive: Boolean(r.strategyActive),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt ?? ''),
      }));
    } catch {
      return [];
    }
  }

  async addProtocolSubscription(strategyId: string, protocolId: string, role = 'long') {
    const existing: any = await (this.prisma as any).strategyProtocol
      .findFirst({ where: { strategyId, protocolId, role } })
      .catch(() => null);
    if (existing) return existing;
    return (this.prisma as any).strategyProtocol.create({ data: { strategyId, protocolId, role } });
  }

  async removeProtocolSubscription(strategyId: string, subId: string) {
    return (this.prisma as any).strategyProtocol.deleteMany({ where: { id: subId, strategyId } });
  }

  /**
   * #714 (2026-09-02) — record a queue-driven evaluation WITHOUT re-scoring.
   * Powers the Strategy Monitor's Last Score / Last Signal from the signal
   * queue snapshot (the same values processSignalQueues gates on).
   */
  async recordEvaluation(strategyId: string, data: {
    symbol: string;
    composite: number;
    signal: string;
    direction?: string | null;
    traded?: boolean;
    tradeTicket?: number | null;
    tradeResult?: string | null;
  }) {
    return this.prisma.strategyEvaluation.create({
      data: {
        strategyId,
        symbol: data.symbol,
        composite: data.composite,
        signal: data.signal,
        direction: data.direction ?? null,
        traded: data.traded ?? false,
        tradeTicket: data.tradeTicket ?? null,
        tradeResult: data.tradeResult ?? null,
      },
    });
  }

  async findAll(): Promise<StrategySummary[]> {
    const strategies = await this.prisma.tradingStrategy.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        evaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take: 1,
        },
        protocols: { orderBy: { sortOrder: 'asc' } },
      },
    });

    // ── Market scope: resolve each strategy's protocol to its watchlist ──────────────────────
    // ⚠️ This crosses a FORMAT boundary. `strategy_protocol.protocolId` (and the legacy
    // `trading_strategy.protocolId`) hold protocol SLUGS; `watchlist.protocolId` holds the protocol
    // UUID. They cannot be compared directly, and the `protocol` table is the only place that
    // carries both — so it is the bridge. This is the same slug-or-UUID hazard as #801.
    //
    // ⚠️ ENRICHMENT, NOT A REQUIREMENT. If this lookup fails the table must still render, so the
    // whole block is best-effort: a strategy simply gets no `watchlists` and the UI falls back to
    // showing its symbol. A market-scope lookup must never be able to blank the strategies list.
    const watchlistsBySlug = new Map<string, Array<{ name: string; symbolCount: number }>>();
    try {
      const slugs = [
        ...new Set(
          strategies
            .flatMap((s) => [
              ...(((s as any).protocols || []) as Array<{ protocolId: string }>).map((p) => p.protocolId),
              s.protocolId,
            ])
            .filter((v): v is string => Boolean(v)),
        ),
      ];

      if (slugs.length) {
        const protoRows = await this.prisma.protocol.findMany({
          where: { slug: { in: slugs } },
          select: { id: true, slug: true },
        });
        const uuidToSlug = new Map(protoRows.map((p) => [p.id, p.slug]));

        if (protoRows.length) {
          const wls = await this.prisma.watchlist.findMany({
            where: { protocolId: { in: protoRows.map((p) => p.id) } },
            select: { name: true, symbols: true, protocolId: true },
          });
          for (const w of wls) {
            const slug = w.protocolId ? uuidToSlug.get(w.protocolId) : undefined;
            if (!slug) continue;
            const arr = (watchlistsBySlug.get(slug) ?? []);
            arr.push({
              name: w.name,
              symbolCount: Array.isArray(w.symbols) ? w.symbols.length : 0,
            });
            watchlistsBySlug.set(slug, arr);
          }
        }
      }
    } catch (e) {
      this.logger.warn(
        `Market scope (watchlist) lookup failed; continuing without it: ${(e as Error)?.message}`,
      );
    }

    return strategies.map((s) => {
      const lastEval = s.evaluations?.[0];
      // Prefer the subscription protocols; fall back to the legacy single link.
      const slugsForThis = [
        ...((((s as any).protocols || []) as Array<{ protocolId: string }>).map((p) => p.protocolId)),
        s.protocolId,
      ].filter((v): v is string => Boolean(v));
      const watchlists = [
        ...new Map(
          slugsForThis.flatMap((slug) => watchlistsBySlug.get(slug) ?? []).map((w) => [w.name, w]),
        ).values(),
      ];
      return {
        id: s.id,
        name: s.name,
        version: (s as any).version ?? null,
        protocolId: s.protocolId,
        shortProtocolId: (s as any).shortProtocolId ?? null,
        protocols: ((s as any).protocols || []).map((p: any) => ({
          id: p.id,
          protocolId: p.protocolId,
          role: p.role,
        })),
        watchlists,
        symbol: s.symbol,
        timeframe: s.timeframe,
        mode: s.mode,
        active: s.active,
        brokerId: s.brokerId,
        // #1018 — MUST BE CARRIED. Omitting it here is what made every order fall back to the
        // bridge's DEFAULT_MAGIC (234000 = "no bot attributed") and left `trade.magic` NULL.
        // See the field's docblock for the full chain; guarded by bot-summary-mapping.spec.ts.
        magic: (s as any).magic ?? null,
        minComposite: s.minComposite,
        baseSize: s.baseSize,
        slPct: s.slPct,
        tpPct: s.tpPct,
        cooldownMinutes: s.cooldownMinutes,
        // Session gate window — consumed by processSignalQueues (Gate 4.5).
        sessionWindow: (s as any).sessionWindow ?? null,
        // Same gate, normalised for display (see the field docs) — `london` and `["london"]` must
        // render identically or the table invents a difference that does not exist.
        sessionTags: parseSessionWindow((s as any).sessionWindow),
        maxPositions: s.maxPositions,
        // Position time-stop (#773) — consumed by PositionTimeStopService. Without this the
        // limit is unreadable and the time-stop silently no-ops.
        maxHoldHours: (s as any).maxHoldHours ?? null,
        // Exit-side session boundary (#928) — consumed by the SAME service. Carried for the same
        // reason: a field the engine reads off this summary is invisible if the summary drops it.
        exitBeforeUtc: (s as any).exitBeforeUtc ?? null,
        maxPyramidTiers: (s as any).maxPyramidTiers ?? 1,
        lastEvaluatedAt: lastEval?.evaluatedAt ? new Date(lastEval.evaluatedAt).toISOString() : null,
        lastSignal: lastEval?.signal ?? null,
        lastComposite: lastEval?.composite ?? null,
        evaluationCount: s.evaluations?.length ?? 0,
        profitRatio: null, totalPnl: null, daysActive: null, // filled below
      };
    });
  }

  /**
   * findAll with profit/runtime ratio (#343).
   * Computes SUM(trade.pnl) / days_active per strategy.
   */
  async findAllWithRatios(): Promise<StrategySummary[]> {
    const strategies = await this.findAll();

    if (!this.prisma.isAvailable || strategies.length === 0) return strategies;

    try {
      // Batch query: P&L per strategy from the trade table
      const trades = await this.prisma.trade.findMany({
        where: {
          scoringStrategyId: { in: strategies.map(s => s.id) },
          pnl: { not: null },
          status: 'closed',
          pnlInvalid: 0, // #931 — phantom closes added 0 to totals but shifted first/last-trade days
        },
        select: { scoringStrategyId: true, pnl: true, openedAt: true },
      });

      // Aggregate per strategy
      const agg = new Map<string, { totalPnl: number; firstTrade: Date; lastTrade: Date }>();
      for (const t of trades) {
        if (!t.scoringStrategyId) continue;
        const entry = agg.get(t.scoringStrategyId) || { totalPnl: 0, firstTrade: t.openedAt, lastTrade: t.openedAt };
        entry.totalPnl += t.pnl || 0;
        if (t.openedAt < entry.firstTrade) entry.firstTrade = t.openedAt;
        if (t.openedAt > entry.lastTrade) entry.lastTrade = t.openedAt;
        agg.set(t.scoringStrategyId, entry);
      }

      // Apply ratios
      for (const s of strategies) {
        const a = agg.get(s.id);
        if (!a) continue;
        const daysActive = Math.max(1, Math.ceil((Date.now() - a.firstTrade.getTime()) / 86400000));
        s.totalPnl = Math.round(a.totalPnl * 100) / 100;
        s.daysActive = daysActive;
        s.profitRatio = Math.round((a.totalPnl / daysActive) * 100) / 100;
      }
    } catch (err) {
      this.logger.warn(`Could not compute profit ratios: ${(err as Error).message}`);
    }

    return strategies;
  }

  async findOne(id: string) {
    return this.prisma.tradingStrategy.findUnique({
      where: { id },
      include: {
        evaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  async create(data: {
    name: string;
    protocolId: string;
    symbol: string;
    description?: string;
    brokerId?: string;
    shortProtocolId?: string;
    scoringStrategyId?: string;
    watchlistId?: string;
    watchlistName?: string;
    timeframe?: string;
    minComposite?: number;
    minRarityBand?: string;
    requireDirection?: string;
    slPct?: number;
    tpPct?: number;
    baseSize?: number;
    useRaritySizing?: boolean;
    maxSize?: number;
    maxPositions?: number;
    maxDailyLoss?: number;
    cooldownMinutes?: number;
    mode?: string;
    active?: boolean;
    hotStockEnabled?: boolean;
    hotStockAllocation?: number;
    hotStockDetectionMode?: string;
    hotStockMaxHoldHours?: number;
    // Added 2026-09-22 for the A/B copy path: three columns the form had never written through
    // this method, plus the lineage pointer. All optional — existing callers are unchanged.
    sessionWindow?: string | null;
    maxHoldHours?: number | null;
    // #928 — the exit-side boundary. Optional like the rest: an existing caller that does not know
    // about it leaves the column NULL, which means "no boundary", so no bot changes behaviour.
    exitBeforeUtc?: string | null;
    maxPyramidTiers?: number;
    duplicatedFromId?: string | null;
    /**
     * #1018 — the bot's MT5 magic. Supplied by the DUPLICATE path (which must not inherit the
     * source's) and omitted by every other caller, in which case one is ALLOCATED below.
     *
     * ⚠️ This DTO is why `commit`-time `magic` was invisible: `duplicate()` calls THIS method, not
     * `prisma.tradingStrategy.create`, so a field absent here cannot reach the database no matter
     * what the caller passes. tsc caught it — `Object literal may only specify known properties` —
     * which is the one place a dropped column is NOT silent.
     */
    magic?: number | null;
  }) {
    // Auto-create ScoringStrategy when watchlist is provided without a scoringStrategyId
    let scoringStrategyId = data.scoringStrategyId ?? null;
    if (!scoringStrategyId && (data.watchlistId || data.watchlistName)) {
      try {
        const watchlistName = data.watchlistName || data.watchlistId || 'default';
        const existingScoring = await (this.prisma as any).scoringStrategy.findFirst({
          where: { protocolId: data.protocolId, watchlistName },
        });
        if (existingScoring) {
          scoringStrategyId = existingScoring.id;
        } else {
          const created = await (this.prisma as any).scoringStrategy.create({
            data: {
              name: `${data.name} Scoring`,
              protocolId: data.protocolId,
              watchlistName,
              watchlistId: data.watchlistId ?? null,
              brokerId: data.brokerId ?? 'mt5',
              mode: data.mode ?? 'score',
              tradeThreshold: data.minComposite ?? BOT_BAR_DEFAULT,
              baseSize: data.baseSize ?? 0.01,
              slPct: data.slPct ?? 1.0,
              tpPct: data.tpPct ?? 1.0,
              enabled: true,
            },
          });
          scoringStrategyId = created.id;
        }
      } catch (err) {
        this.logger.warn(`Auto-create ScoringStrategy failed for ${data.name}: ${(err as Error).message}`);
      }
    }

    // #905 — a bot created ACTIVE must be able to fire. (Default creation is active=false,
    // so this only refuses the deliberate activate-on-create case.)
    if (data.active === true) {
      await this.assertCeilingAllowsActivation(
        data.protocolId,
        data.minComposite ?? BOT_BAR_DEFAULT,
        data.name,
      );
    }

    return this.prisma.tradingStrategy.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        protocolId: data.protocolId,
        shortProtocolId: data.shortProtocolId ?? null,
        scoringStrategyId,
        symbol: data.symbol.toUpperCase(),
        brokerId: data.brokerId ?? 'mt5',
        timeframe: data.timeframe ?? '5m',
        minComposite: data.minComposite ?? BOT_BAR_DEFAULT,
        minRarityBand: data.minRarityBand ?? null,
        requireDirection: data.requireDirection ?? null,
        slPct: data.slPct ?? 1.0,
        tpPct: data.tpPct ?? 1.0,
        baseSize: data.baseSize ?? 0.01,
        useRaritySizing: data.useRaritySizing ?? true,
        maxSize: data.maxSize ?? null,
        maxPositions: data.maxPositions ?? 1,
        maxDailyLoss: data.maxDailyLoss ?? null,
        cooldownMinutes: data.cooldownMinutes ?? 5,
        mode: data.mode ?? 'manual',
        active: data.active ?? false,
        hotStockEnabled: data.hotStockEnabled ?? false,
        hotStockAllocation: data.hotStockAllocation ?? null,
        hotStockDetectionMode: data.hotStockDetectionMode ?? null,
        hotStockMaxHoldHours: data.hotStockMaxHoldHours ?? null,
        sessionWindow: data.sessionWindow ?? null,
        maxHoldHours: data.maxHoldHours ?? null,
        exitBeforeUtc: data.exitBeforeUtc ?? null,
        maxPyramidTiers: data.maxPyramidTiers ?? undefined,
        duplicatedFromId: data.duplicatedFromId ?? null,
        // #1018 — EVERY bot gets a magic, including one created through the API. An explicit value
        // is honoured (the duplicate path needs a DIFFERENT one from its source); otherwise the
        // next free value is allocated, so "no bot attributed" cannot be the normal case.
        magic: data.magic ?? (await this.allocateMagic()),
      },
    });
  }

  async update(id: string, data: Record<string, any>) {
    const existing = await this.prisma.tradingStrategy.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Strategy not found');

    // ⚠️ #963 / decision 25 invariant 6 — a RUNNING comparison freezes both sides. This is FIRST,
    // before the ceiling gate, because it is about the validity of an in-flight measurement
    // rather than the viability of the bot.
    await this.assertPairAllowsEdit(id, data);

    // #905 — gate only the transitions that matter: activating, or changing the bar/protocol
    // of an ACTIVE bot. A rename of an already-active impossible bot is still allowed — the
    // health audit surfaces it — so operators are never locked out of editing a stranded bot.
    const resultingActive = data.active !== undefined ? Boolean(data.active) : existing.active;
    const reactivation = resultingActive && !existing.active;
    const barOrProtocolChanged = data.minComposite !== undefined || data.protocolId !== undefined;
    if (resultingActive && (reactivation || barOrProtocolChanged)) {
      await this.assertCeilingAllowsActivation(
        data.protocolId ?? existing.protocolId,
        data.minComposite ?? existing.minComposite,
        existing.name,
      );
    }

    return this.prisma.tradingStrategy.update({ where: { id }, data });
  }

  /**
   * remove() — delete a bot, GUARDED, with the cleanup MyISAM cannot do for us (2026-09-22).
   *
   * ⚠️ REFUSES while the bot is active (TCS-TRADE-018, 409). This is not politeness: the queue
   * and the execution loop both read `trading_strategy` rows, so removing an active one removes
   * the configuration that live orders were about to be checked against. The remedy — deactivate
   * first — costs one click and is always allowed.
   *
   * ⚠️ NO CASCADES EXIST — the explicit cleanup below is the reason.
   *
   * ⚠️ The JUSTIFICATION was corrected 2026-09-23. It read *"every table in this database is
   * MyISAM"*, which is **false**: measured **28 InnoDB / 100 MyISAM**, and `trading_strategy` is
   * InnoDB — so `onDelete: Cascade` may genuinely fire for some children. The explicit deletes
   * stay anyway, for a better reason than the original one: they **COUNT** what they removed and
   * return it, while a cascade is silent. An unobservable cleanup is the defect. Children are therefore removed
   * explicitly and counted into the returned report:
   *   - `strategy_protocol`       — subscriptions (the reachability path, #874)
   *   - `strategy_signal_queue`   — PENDING rows only; executed history is never touched
   *   - `strategy_evaluation`     — this bot's decision telemetry
   *   - `trading_strategy` copies — `duplicatedFromId` pointers to this bot are CLEARED, so a
   *                                 surviving copy does not keep a dangling ancestor id
   *   - `protocol` copies         — deleted ONLY when (a) the slug is a copy and (b) nothing else
   *                                 references it. Checks the DB; does not assume.
   *
   * ⚠️ RETAINED DELIBERATELY: decision logs, scores, signals and trades. They are history, and
   * a history row that outlives its configuration is an audit trail — not an orphan.
   */
  async remove(id: string) {
    const bot = await this.prisma.tradingStrategy.findUnique({
      where: { id },
      include: { protocols: true },
    });
    if (!bot) throw new BadRequestException('Strategy not found');

    if (bot.active) {
      throw new TcsNoticeException('TCS-TRADE-018', { name: bot.name }, {
        detail: `active=true — bot "${bot.name}" (${bot.id}) must be deactivated before deletion`,
      });
    }

    // 1. Child rows the bot owns. Any failure here is loud: a half-deleted bot is worse than
    //    a refused one, because it looks gone while its subscriptions still route signals.
    const subs = await (this.prisma as any).strategyProtocol.deleteMany({ where: { strategyId: id } });
    const evals = await (this.prisma as any).strategyEvaluation.deleteMany({ where: { strategyId: id } });
    let queueRows = 0;
    try {
      queueRows = await (this.prisma as any).$executeRawUnsafe(
        `DELETE FROM strategy_signal_queue WHERE strategyId = ? AND status = 'pending'`,
        id,
      );
    } catch (err) {
      this.logger.warn(`Could not clear pending queue rows for ${id}: ${(err as Error).message}`);
    }

    // 2. Lineage — clear pointers held BY OTHER BOTS. (Any rows where THIS bot was copied FROM.)
    const cleared = await this.prisma.tradingStrategy.updateMany({
      where: { duplicatedFromId: id },
      data: { duplicatedFromId: null },
    });

    // 3. The bot row itself.
    await this.prisma.tradingStrategy.delete({ where: { id } });

    // 4. Protocol copies that nothing else uses. The pattern test and the reference count are
    //    BOTH required — a copy shared by a surviving sibling must stay.
    const refs = new Set<string>();
    for (const s of bot.protocols ?? []) refs.add(s.protocolId);
    if (bot.protocolId) refs.add(bot.protocolId);
    if (bot.shortProtocolId) refs.add(bot.shortProtocolId);

    const removedProtocols: string[] = [];
    const keptProtocols: Array<{ ref: string; reason: string }> = [];
    for (const ref of refs) {
      const row: any = await (this.prisma as any).protocol.findFirst({
        where: { OR: [{ slug: ref }, { id: ref }] },
        select: { id: true, slug: true },
      });
      if (!row) continue;
      if (!/-copy(-\d+)?$/.test(row.slug)) {
        keptProtocols.push({ ref: row.slug, reason: 'not a copy — original or shared protocol' });
        continue;
      }
      const otherBots = await this.prisma.tradingStrategy.count({
        where: {
          OR: [
            { protocolId: row.slug },
            { protocolId: row.id },
            { shortProtocolId: row.slug },
            { shortProtocolId: row.id },
          ],
        },
      });
      const otherSubs = await (this.prisma as any).strategyProtocol.count({
        where: { protocolId: { in: [row.slug, row.id] } },
      });
      if (otherBots > 0 || otherSubs > 0) {
        keptProtocols.push({ ref: row.slug, reason: 'still referenced by another bot' });
        continue;
      }
      await this.protocolDb.deleteCopyProtocol(row.slug);
      removedProtocols.push(row.slug);
    }

    // 5. Scoring strategies that belong to the removed protocol copies. `create()` auto-creates
    //    one per (protocolId, watchlistName), so a duplicate's scoring strategy is keyed to the
    //    COPY's slug — unique to the copy, and an orphan once the protocol is gone. Matched by
    //    protocolId, never by name: a name match could delete a shared configuration.
    let removedScoringStrategies = 0;
    if (removedProtocols.length) {
      const ss = await (this.prisma as any).scoringStrategy.deleteMany({
        where: { protocolId: { in: removedProtocols } },
      });
      removedScoringStrategies = ss.count;
    }

    const detail = [
      `${subs.count} protocol subscription(s)`, `${queueRows} pending queue row(s)`,
      `${evals.count} evaluation row(s)`,
      removedProtocols.length
        ? `${removedProtocols.length} protocol copy(ies) (${removedProtocols.join(', ')})`
        : 'no protocol copies removed',
      removedScoringStrategies ? `${removedScoringStrategies} scoring strategy(ies)` : null,
      cleared.count ? `${cleared.count} copy pointer(s) cleared` : null,
      keptProtocols.length
        ? `kept: ${keptProtocols.map((k) => `${k.ref} (${k.reason})`).join('; ')}`
        : null,
      'decision history and trades are retained',
    ].filter(Boolean).join('; ');
    this.logger.log(`Deleted bot "${bot.name}" (${id}): ${detail}`);

    return {
      deleted: true,
      botId: id,
      name: bot.name,
      symbol: bot.symbol,
      removedSubscriptions: subs.count,
      removedQueueRows: queueRows,
      removedEvaluations: evals.count,
      removedScoringStrategies,
      clearedLineagePointers: cleared.count,
      removedProtocols,
      keptProtocols,
      detail,
    };
  }

  /** An unused `<base>` / `<base> (2)` / `<base> (3)` bot name — the copy is human-identifiable. */
  private async uniqueBotName(base: string): Promise<string> {
    const trimmed = base.length > 120 ? base.slice(0, 120) : base;
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? trimmed : `${trimmed} (${n})`;
      const hit = await this.prisma.tradingStrategy.findFirst({
        where: { name: candidate },
        select: { id: true },
      });
      if (!hit) return candidate;
    }
    throw new BadRequestException(`Could not find a free copy name for "${base}"`);
  }

  /**
   * duplicate() — copy a bot AND its protocol as the B of a new A/B pair (2026-09-22).
   *
   * OWNER'S MODEL, verbatim: *"the ability to easily get the required records, correct and
   * complete, insert fresh records using the correct endpoints, and doing so should result in not
   * only a new strategy but a connection maintained between A and B."* And on C/D: *"it really
   * just makes B, A for the additional pair rather than a C"* — so every duplicate starts its OWN
   * pair, and this method never tries to build a group of three.
   *
   * ⚠️ THE SYMBOL IS THE ONE THING THAT DOES NOT CHANGE. A/B is a comparison of TREATMENT on the
   * same market — the copy inherits `symbol` exactly, and the page refuses to pair across symbols.
   * Changing the symbol while copying is a strategy COMPARISON, not an A/B test, and it belongs to
   * a separate feature (see the A/B Strategies page's cross-symbol refusal).
   *
   * THE LINKS MAINTAINED (two, not one):
   *   - protocol copy → `Protocol.derivedFrom` = source protocol slug
   *   - bot copy      → `TradingStrategy.duplicatedFromId` = source bot id
   *
   * ⚠️ THE COPY GETS A SUBSCRIPTION EVEN IF THE SOURCE HAD NONE. A legacy-only source (#874: no
   * `strategy_protocol` row, so it can never trade) would otherwise produce a copy that is ALSO
   * unreachable — a duplicate of a defect. B must be able to fire once activated.
   *
   * ⚠️ THE COPY STARTS INACTIVE. Both sides running the same playbook at once is not an A/B test;
   * the operator edits B, then activates it deliberately.
   *
   * MyISAM has no transactions, so a failure mid-copy cleans up in reverse by hand — a partial
   * copy that LOOKS complete is the failure mode this guards against.
   */
  /**
   * allocateMagic() — the next free per-bot MT5 magic (#1018).
   *
   * ⚠️ 234000 IS RESERVED AND MUST NEVER BE HANDED OUT. It is the bridge's `DEFAULT_MAGIC`, i.e.
   * "no bot attributed" (see `mt5_bridge_v2.py`), so a bot carrying it would be indistinguishable
   * from an unattributed position. Per-bot magics start at 234100, matching the seed's convention.
   *
   * ⚠️ `max + 1`, NEVER a count or a lowest-free. Magic is IMMUTABLE on a position in MT5, so
   * reusing a value freed by a deleted bot would silently re-attribute every position that bot
   * still has open.
   */
  private async allocateMagic(): Promise<number> {
    const MAGIC_FLOOR = 234100;
    const top = await this.prisma.tradingStrategy.aggregate({ _max: { magic: true } });
    const highest = top?._max?.magic ?? MAGIC_FLOOR - 1;
    return Math.max(highest + 1, MAGIC_FLOOR);
  }

  async duplicate(id: string) {
    const source = await this.prisma.tradingStrategy.findUnique({
      where: { id },
      include: { protocols: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) throw new BadRequestException('Strategy not found');

    // Protocol references: subscriptions are canonical (#874); the legacy columns are the
    // fallback (#801 — the value may be a slug OR a uuid).
    const links: Array<{ ref: string; role: string; legacyShort: boolean }> = [];
    for (const sub of source.protocols ?? []) {
      links.push({ ref: sub.protocolId, role: sub.role || 'long', legacyShort: false });
    }
    if (links.length === 0) {
      if (source.protocolId) links.push({ ref: source.protocolId, role: 'long', legacyShort: false });
      if (source.shortProtocolId) links.push({ ref: source.shortProtocolId, role: 'short', legacyShort: true });
    }
    if (links.length === 0) {
      throw new BadRequestException(
        `"${source.name}" has no protocol link, so there is no configuration to copy. ` +
        `Subscribe a protocol to it first (#874).`,
      );
    }

    const createdProtocols: Array<{ slug: string }> = [];
    let copyBotId: string | null = null;

    try {
      // 1. Copy every protocol the source consumes, preserving weights exactly.
      const copiedLinks: Array<{
        sourceSlug: string; copySlug: string; role: string; legacyShort: boolean;
        groups: number; entries: number; assignments: number;
        watchlists: Array<{ id: string; name: string }>;
      }> = [];
      for (const link of links) {
        const srcProtocol: any = await (this.prisma as any).protocol.findFirst({
          where: { OR: [{ slug: link.ref }, { id: link.ref }] },
          select: { id: true, slug: true, name: true },
        });
        if (!srcProtocol) {
          throw new BadRequestException(
            `Protocol "${link.ref}" referenced by "${source.name}" does not exist in the database, ` +
            `so the copy was stopped before anything was written.`,
          );
        }
        const copySlug = await this.protocolDb.uniqueCopySlug(srcProtocol.slug);
        const result = await this.protocolDb.copyProtocol(srcProtocol.slug, {
          slug: copySlug,
          name: `${srcProtocol.name} (copy)`,
        });
        createdProtocols.push({ slug: result.protocol.slug });
        copiedLinks.push({
          sourceSlug: srcProtocol.slug,
          copySlug: result.protocol.slug,
          role: link.role,
          legacyShort: link.legacyShort,
          groups: result.groups,
          entries: result.entries,
          assignments: result.assignments,
          watchlists: result.watchlists,
        });
      }

      // The copy's own scoring strategy: prefer a watchlist the copy now OWNS (so B scores via
      // its own symbols), else the source scoring strategy's watchlist name (symbols are a
      // scope, not a treatment — sharing one is acceptable; sharing the config would not be).
      let sourceWatchlistName: string | null = null;
      if (source.scoringStrategyId) {
        const ss: any = await (this.prisma as any).scoringStrategy
          .findUnique({ where: { id: source.scoringStrategyId }, select: { watchlistName: true } })
          .catch(() => null);
        sourceWatchlistName = ss?.watchlistName ?? null;
      }
      const firstCopiedWatchlist = copiedLinks.flatMap((l) => l.watchlists)[0] ?? null;
      const watchlistName = firstCopiedWatchlist?.name ?? sourceWatchlistName ?? undefined;

      // 2. The bot. Treatment copied field-for-field; `active: false` is deliberate (see above).
      const copyName = await this.uniqueBotName(`${source.name} (copy)`);
      const bot = await this.create({
        name: copyName,
        description: source.description ?? undefined,
        protocolId: copiedLinks[0].copySlug,
        shortProtocolId: copiedLinks.find((l) => l.legacyShort)?.copySlug ?? undefined,
        symbol: source.symbol,
        brokerId: source.brokerId ?? undefined,
        timeframe: source.timeframe ?? undefined,
        minComposite: source.minComposite ?? undefined,
        minRarityBand: source.minRarityBand ?? undefined,
        requireDirection: source.requireDirection ?? undefined,
        slPct: source.slPct ?? undefined,
        tpPct: source.tpPct ?? undefined,
        baseSize: source.baseSize ?? undefined,
        useRaritySizing: source.useRaritySizing ?? undefined,
        maxSize: source.maxSize ?? undefined,
        maxPositions: source.maxPositions ?? undefined,
        maxDailyLoss: source.maxDailyLoss ?? undefined,
        cooldownMinutes: source.cooldownMinutes ?? undefined,
        mode: source.mode ?? undefined,
        sessionWindow: source.sessionWindow ?? null,
        maxHoldHours: source.maxHoldHours ?? null,
        // #928 — a COPY must inherit the exit boundary, or the A/B comparison this repo requires
        // for a maths change would silently compare a gated configuration against an ungateable
        // one. Copied with the rest of the exit policy, not omitted like `magic` (which must
        // differ per bot on purpose).
        exitBeforeUtc: source.exitBeforeUtc ?? null,
        maxPyramidTiers: source.maxPyramidTiers ?? undefined,
        hotStockEnabled: source.hotStockEnabled ?? undefined,
        hotStockAllocation: source.hotStockAllocation ?? undefined,
        hotStockDetectionMode: source.hotStockDetectionMode ?? undefined,
        hotStockMaxHoldHours: source.hotStockMaxHoldHours ?? undefined,
        watchlistName,
        active: false,
        duplicatedFromId: source.id,
        // #1018 — A COPY NEEDS ITS OWN MAGIC, and this was omitted.
        //
        // MEASURED 2026-09-29: ALL FIVE bots with a NULL magic were `(copy)` bots — every one of
        // them ACTIVE with a live position. `Gold Swing 1H (copy)`'s XAUUSD position was therefore
        // attributable by neither key (its order comment had been mangled to `TCS Gold Swing 1H
        // copy`) and sat UNMANAGED for 341 consecutive ticks. The duplicate path was the only
        // creator of magics less bots — the seed assigns them, this did not.
        //
        // ⚠️ IT MUST NOT INHERIT THE SOURCE'S MAGIC. Two bots sharing one magic makes every
        // position the copy opens indistinguishable from the source's — exactly the conflation
        // `magic` exists to prevent, and magic is immutable on a position once placed.
        magic: await this.allocateMagic(),
      });
      copyBotId = bot.id;

      // 3. Subscriptions — the path the queue actually routes by (#874).
      for (const link of copiedLinks) {
        await this.addProtocolSubscription(bot.id, link.copySlug, link.role);
      }

      this.logger.log(
        `Duplicated bot "${source.name}" (${source.id}) → "${bot.name}" (${bot.id}) — ` +
        `protocol(s): ${copiedLinks.map((l) => `${l.sourceSlug}→${l.copySlug}`).join(', ')}; ` +
        `${copiedLinks.length} subscription(s); starts INACTIVE`,
      );

      return {
        created: true,
        sourceBotId: source.id,
        sourceName: source.name,
        botId: bot.id,
        name: bot.name,
        symbol: bot.symbol,
        active: bot.active,
        duplicatedFromId: source.id,
        subscriptions: copiedLinks.length,
        protocols: copiedLinks.map((l) => ({
          source: l.sourceSlug,
          copy: l.copySlug,
          role: l.role,
          groups: l.groups,
          entries: l.entries,
          assignments: l.assignments,
          watchlists: l.watchlists.map((w) => w.name),
        })),
        watchlistName: watchlistName ?? null,
      };
    } catch (err) {
      // Reverse-order cleanup, best effort. MyISAM cannot roll back, so every created row is
      // named here rather than left behind as a half-copy nobody can identify.
      this.logger.error(`Duplicate of ${source.id} failed — cleaning up: ${(err as Error).message}`);
      try {
        if (copyBotId) {
          await (this.prisma as any).strategyProtocol.deleteMany({ where: { strategyId: copyBotId } });
          await this.prisma.tradingStrategy.delete({ where: { id: copyBotId } });
        }
      } catch (cleanupErr) {
        this.logger.error(`  cleanup: failed to remove the partial bot copy ${copyBotId}: ${(cleanupErr as Error).message}`);
      }
      for (const p of createdProtocols) {
        try {
          await this.protocolDb.deleteCopyProtocol(p.slug);
        } catch (cleanupErr) {
          this.logger.error(`  cleanup: failed to remove the partial protocol copy ${p.slug}: ${(cleanupErr as Error).message}`);
        }
      }
      throw err;
    }
  }

  async toggle(id: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id } });
    if (!strategy) throw new Error('Strategy not found');
    const nextActive = !strategy.active;
    // #905 — refuse to ACTIVATE a bot whose protocol's measured ceiling is below its bar.
    // Deactivating is always allowed.
    if (nextActive) {
      await this.assertCeilingAllowsActivation(strategy.protocolId, strategy.minComposite, strategy.name);
    }
    return this.prisma.tradingStrategy.update({
      where: { id },
      data: { active: nextActive },
    });
  }

  /**
   * getPair() — resolve a bot's A/B pairing (#963, SETTLED-DECISIONS #25).
   *
   * ⚠️ WHY THIS EXISTS. `duplicate()` has always RECORDED the pairing — it sets
   * `duplicatedFromId` on the copy and preserves both lineage links — but nothing ever READ it
   * back. A recorded relationship that nothing can resolve is a buried ability: the operator has
   * two bots and no way to see that they are a pair. This is the read.
   *
   * The DIRECTION matters and is the reason the copy carries the pointer and the source does not:
   * the source is the **incumbent** (the treatment currently in production), the copy is the
   * **variant** (the candidate). "Which of these two is the one I am changing?" is otherwise
   * unanswerable from the rows alone.
   *
   * ⚠️ A GROUP IS NOT A PAIR. Two or more copies of one bot is a group, and a group has no single
   * comparison — `duplicate()`'s own comment says *"this method never tries to build a group of
   * three"*. Rather than pick one arbitrarily (which would silently compare the wrong two
   * things), this returns `paired: false` WITH the reason. Cannot-judge is a result.
   */
  async getPair(id: string): Promise<{
    paired: boolean;
    incumbent: { id: string; name: string; active: boolean; symbol: string } | null;
    variant: { id: string; name: string; active: boolean; symbol: string } | null;
    inSync: boolean;
    reason?: string;
  }> {
    const bot = await this.prisma.tradingStrategy.findUnique({ where: { id } });
    if (!bot) throw new BadRequestException('Strategy not found');

    const shape = (b: any) => ({
      id: b.id,
      name: b.name,
      active: Boolean(b.active),
      symbol: b.symbol,
    });
    const none = { paired: false, incumbent: null, variant: null, inSync: true };

    // ⚠️ ORDER MATTERS — the CHILD pair wins over the PARENT one.
    //
    // Owner point, 2026-09-23: *"B can be duplicated and thus becomes A in a new pair."* So a bot
    // in the MIDDLE of a chain is BOTH the variant of its parent's pair AND the incumbent of its
    // own. `B` (copied from `A`, and since copied to `B'`) must resolve to the **B & B'** pair,
    // because that is the live comparison.
    //
    // ⚠️ THIS WAS A REAL DEFECT. Checking `duplicatedFromId` FIRST made `getPair(B)` report the
    // STALE A & B pair, so `startPair(B)` would have started the wrong comparison and
    // `getPairStatus(B)` would have read the wrong `ab_pair` row — both silently, on exactly the
    // workflow the owner described as needing no extra work.
    //
    // A bot WITH copies is therefore an INCUMBENT; only a bot with NO copies falls back to being
    // its parent's variant.
    const copies = await this.prisma.tradingStrategy.findMany({ where: { duplicatedFromId: id } });

    if (copies.length > 1) {
      return {
        ...none,
        incumbent: shape(bot),
        reason:
          `${copies.length} bots were copied from "${bot.name}" ` +
          `(${copies.map((c) => c.name).join(', ')}) — that is a GROUP, not a pair, and a group ` +
          `has no single comparison`,
      };
    }
    if (copies.length === 1) {
      return {
        paired: true,
        incumbent: shape(bot),
        variant: shape(copies[0]),
        inSync: Boolean(bot.active) === Boolean(copies[0].active),
      };
    }

    // No copies at all: this bot is the VARIANT of its parent's pair — if it has a parent.
    if (bot.duplicatedFromId) {
      const incumbent = await this.prisma.tradingStrategy.findUnique({
        where: { id: bot.duplicatedFromId },
      });
      if (!incumbent) {
        return {
          ...none,
          incumbent: null,
          variant: shape(bot),
          reason:
            `duplicatedFromId ${bot.duplicatedFromId} does not exist — the lineage is DANGLING, ` +
            `so this pair cannot be judged`,
        };
      }
      return {
        paired: true,
        incumbent: shape(incumbent),
        variant: shape(bot),
        inSync: Boolean(incumbent.active) === Boolean(bot.active),
      };
    }

    return none;
  }

  /**
   * setPairActive() — activate or deactivate BOTH sides together (#963, decision 25).
   *
   * Owner's words: *"ensuring they are activate/deactivated together."* That is the whole method.
   *
   * ⚠️ WHY IT IS A SEPARATE OPERATION rather than a rule inferred inside `update()`. `active`
   * CANNOT distinguish "the comparison has not started yet" from "the pair has drifted out of
   * sync" — a freshly duplicated pair is deliberately `A active / B inactive` (*"both sides
   * running the same playbook at once is not an A/B test"*), which is byte-identical to a broken
   * pair. A guard inferred from the two flags alone would therefore be WRONG in one direction and
   * would eventually lock an operator out of a legitimate edit. So the togetherness is an
   * EXPLICIT operator action here, and the declared comparison state that would make it inferable
   * is recorded as the remaining work on #963.
   *
   * ⚠️ CORRECTED 2026-09-23. This paragraph used to say "MyISAM has no transactions". **"Every
   * table is MyISAM" is false** — measured: **28 InnoDB, 100 MyISAM**, and `trading_strategy` is
   * **InnoDB**. That is why `startPair()`/`stopPair()` above use a real `$transaction` instead of a
   * hand-rolled revert. The best-effort revert below is retained because it is tested and cannot
   * hurt, but it is now the **second** atomicity mechanism in this file, and consolidating it onto
   * `$transaction` is the known follow-up (#963).
   *
   * ⚠️ The #905 ceiling gate is applied per side being ACTIVATED. Going through the pair must
   * never be a way to bypass it.
   */
  async setPairActive(id: string, active: boolean) {
    const pair = await this.getPair(id);
    if (!pair.paired || !pair.incumbent || !pair.variant) {
      throw new BadRequestException(
        `"${id}" is not a resolvable A/B pair: ` +
          (pair.reason ?? 'the bot has no copy and no duplicatedFromId pointer'),
      );
    }

    // Ceiling gate for each side that would transition inactive → active (#905).
    if (active) {
      for (const side of [pair.incumbent, pair.variant]) {
        if (side.active) continue; // already active — nothing is being activated
        const row = await this.prisma.tradingStrategy.findUnique({ where: { id: side.id } });
        if (row) await this.assertCeilingAllowsActivation(row.protocolId, row.minComposite, row.name);
      }
    }

    const incumbentId = pair.incumbent.id;
    const variantId = pair.variant.id;
    // ⚠️ Record the value BEFORE each write, and restore THAT — not `!active`.
    //
    // The first version of this reverted only when `Boolean(row.active) !== active`, which asks
    // "is this row not at the target?" — so a row that HAD just been moved to the target was
    // skipped by the very check meant to catch it, and a half-applied pair was left looking
    // synchronised. The spec's REVERTS test failed with "expected false, received true".
    const applied: Array<{ id: string; name: string; was: boolean }> = [];

    try {
      for (const sideId of [incumbentId, variantId]) {
        const row = await this.prisma.tradingStrategy.findUnique({ where: { id: sideId } });
        if (!row) throw new BadRequestException(`Pair member ${sideId} disappeared mid-operation`);
        if (Boolean(row.active) === active) continue;
        await this.prisma.tradingStrategy.update({ where: { id: sideId }, data: { active } });
        applied.push({ id: sideId, name: row.name, was: Boolean(row.active) });
      }
    } catch (err) {
      // Reverse what landed, newest first, so the pair is left exactly as it was found.
      for (const a of [...applied].reverse()) {
        try {
          await this.prisma.tradingStrategy.update({ where: { id: a.id }, data: { active: a.was } });
        } catch {
          /* best-effort; the throw below is the loud part */
        }
      }
      throw new BadRequestException(
        `Refused: the pair could not be moved together — ${(err as Error).message}. ` +
          `Any change that landed was reverted; verify with GET /api/trading/strategies/${id}/pair.`,
      );
    }

    const changed = applied.map((a) => a.name);

    this.logger.log(
      `A/B pair ${active ? 'ACTIVATED' : 'DEACTIVATED'} together — ` +
        `incumbent "${pair.incumbent.name}" + variant "${pair.variant.name}" ` +
        `(${changed.length ? changed.join(', ') : 'already in step'})`,
    );

    return {
      pair: await this.getPair(id),
      requested: active,
      changed,
      alreadyInStep: changed.length === 0,
    };
  }

  /**
   * getPairStatus() — the pair PLUS its registered comparison (#963, decision 25).
   *
   * `getPair()` answers "who is paired with whom". This answers "and what is the comparison
   * doing" — which is a RECORDED fact, not an inference (see the `AbPair` model).
   *
   * ⚠️ `paired: true` with `registered: false` is a normal, meaningful state: the bots are a
   * pair, but no comparison has been declared or started yet. That is a different fact from
   * `paired: false` (they are not a pair at all), and the two must not render the same.
   */
  async getPairStatus(id: string) {
    const pair = await this.getPair(id);
    const row = await this.prisma.abPair.findUnique({ where: { variantId: pair.variant?.id ?? '' } });
    return {
      ...pair,
      comparison: row
        ? {
            registered: true,
            id: row.id,
            state: row.state,
            declaredChange: row.declaredChange,
            falsification: row.falsification,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
          }
        : { registered: false, state: 'unregistered' as const },
    };
  }

  /**
   * startPair() — BEGIN a comparison, and make it a RECORDED fact (#963, decision 25).
   *
   * Owner's words: *"protocols will have A/B testing in a way that locks both protocols to ensure
   * that activity matches"*. This is the lock. From here both sides are active, and neither can be
   * edited until the comparison stops — so the two sides are measured over the SAME period with
   * the SAME configuration they started with.
   *
   * ⚠️ A DECLARED CHANGE IS MANDATORY (invariant 4). Without it a result has nothing to be
   * attributed to, and "something changed and the number moved" is not a finding — it is the
   * observation that A/B exists to replace.
   */
  async startPair(id: string, input: { declaredChange?: string; falsification?: string } = {}) {
    const pair = await this.getPair(id);
    if (!pair.paired || !pair.incumbent || !pair.variant) {
      throw new BadRequestException(
        `"${id}" is not a resolvable A/B pair: ` +
          (pair.reason ?? 'the bot has no copy and no duplicatedFromId pointer'),
      );
    }

    const declaredChange = (input.declaredChange ?? '').trim();
    if (!declaredChange) {
      throw new BadRequestException(
        'Refused: a comparison must declare the ONE field it is testing (#963). Without it the ' +
          'result cannot be attributed to anything, and "something changed and the number moved" ' +
          'is not a finding.',
      );
    }

    const alreadyRunning = await this.prisma.abPair.findFirst({
      where: { state: 'running', OR: [{ incumbentId: id }, { variantId: id }] },
    });
    if (alreadyRunning) {
      throw new BadRequestException(
        `Refused: this pair is ALREADY running (testing "${alreadyRunning.declaredChange ?? 'undeclared'}"). ` +
          `Stop it before starting another — one running comparison per pair (#963).`,
      );
    }

    // Ceiling gate per side being activated (#905) — the pair is not a way to bypass it.
    for (const side of [pair.incumbent, pair.variant]) {
      if (side.active) continue;
      const row = await this.prisma.tradingStrategy.findUnique({ where: { id: side.id } });
      if (row) await this.assertCeilingAllowsActivation(row.protocolId, row.minComposite, row.name);
    }

    const incumbentId = pair.incumbent.id;
    const variantId = pair.variant.id;
    const now = new Date();
    const existingRow = await this.prisma.abPair.findUnique({ where: { variantId } });

    // ⚠️ ONE TRANSACTION, and that is possible HERE. `trading_strategy` and `ab_pair` are both
    // InnoDB (measured 2026-09-23: 28 tables InnoDB, 100 MyISAM). `duplicate()` cannot use one
    // because it spans the MyISAM `protocol` table; this path touches only InnoDB, so a
    // half-started comparison is simply not possible rather than merely unlikely.
    const ops: any[] = [
      this.prisma.tradingStrategy.update({ where: { id: incumbentId }, data: { active: true } }),
      this.prisma.tradingStrategy.update({ where: { id: variantId }, data: { active: true } }),
      existingRow
        ? this.prisma.abPair.update({
            where: { variantId },
            data: {
              state: 'running',
              declaredChange: declaredChange.slice(0, 120),
              falsification: input.falsification?.trim() || null,
              startedAt: now,
              endedAt: null,
            },
          })
        : this.prisma.abPair.create({
            data: {
              incumbentId,
              variantId,
              state: 'running',
              declaredChange: declaredChange.slice(0, 120),
              falsification: input.falsification?.trim() || null,
              startedAt: now,
            },
          }),
    ];
    const results: any[] = await this.prisma.$transaction(ops);
    const registered = results[2];

    this.logger.log(
      `A/B comparison STARTED — "${pair.incumbent.name}" vs "${pair.variant.name}", ` +
        `testing "${declaredChange}". Both sides are now active and frozen.`,
    );

    return {
      started: true,
      comparisonId: registered?.id ?? null,
      declaredChange,
      pair: await this.getPairStatus(id),
    };
  }

  /**
   * stopPair() — END a comparison and take both sides out together (#963).
   *
   * Deactivates BOTH, so the pair is never left half-live. Promoting the winner is a separate,
   * deliberate act — this only stops the measurement.
   */
  async stopPair(id: string) {
    const pair = await this.getPair(id);
    if (!pair.paired || !pair.incumbent || !pair.variant) {
      throw new BadRequestException(
        `"${id}" is not a resolvable A/B pair: ` +
          (pair.reason ?? 'the bot has no copy and no duplicatedFromId pointer'),
      );
    }

    const row = await this.prisma.abPair.findUnique({ where: { variantId: pair.variant.id } });
    if (!row || row.state !== 'running') {
      throw new BadRequestException(
        'Refused: there is no RUNNING comparison for this pair, so there is nothing to stop (#963). ' +
          `Current state: ${row?.state ?? 'unregistered'}.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.tradingStrategy.update({ where: { id: pair.incumbent.id }, data: { active: false } }),
      this.prisma.tradingStrategy.update({ where: { id: pair.variant.id }, data: { active: false } }),
      this.prisma.abPair.update({
        where: { variantId: pair.variant.id },
        data: { state: 'complete', endedAt: new Date() },
      }),
    ]);

    this.logger.log(
      `A/B comparison STOPPED — "${pair.incumbent.name}" vs "${pair.variant.name}" ` +
        `(testing "${row.declaredChange ?? 'undeclared'}"). Both sides deactivated.`,
    );

    return { stopped: true, declaredChange: row.declaredChange, pair: await this.getPairStatus(id) };
  }

  /**
   * assertPairAllowsEdit() — INVARIANT 6: a RUNNING comparison freezes both sides (#963).
   *
   * ⚠️ WHY THIS IS A GUARD AND NOT A WARNING. Editing one side mid-comparison does not corrupt a
   * number — it invalidates the whole METHOD. The two sides would then have been measured under
   * different configurations, so the result describes neither, and nothing in the output looks
   * wrong. Refusing is the only outcome that keeps the measurement honest.
   *
   * ⚠️ "Behavioural" comes from the CANONICAL lists (`BOT_RULES` minus `NON_BEHAVIOURAL_COLUMNS`),
   * not from a second hand-written list. A field added to `BOT_RULES` is therefore covered
   * automatically — the failure mode this avoids is a new field silently escaping the freeze.
   *
   * Fail-OPEN on anything it cannot classify: an unknown key is ignored rather than refused, so a
   * future non-behavioural column cannot lock the app. The freeze must not become a trap.
   */
  private async assertPairAllowsEdit(botId: string, data: Record<string, any>): Promise<void> {
    const keys = Object.keys(data ?? {}).filter((k) => data[k] !== undefined);
    if (keys.length === 0) return;

    const nonBehavioural = new Set<string>(NON_BEHAVIOURAL_COLUMNS as readonly string[]);
    const declared = new Set<string>(BOT_RULES.map((r) => r.field));
    const behavioural = keys.filter((k) => !nonBehavioural.has(k) && declared.has(k));
    if (behavioural.length === 0) return;

    const running = await this.prisma.abPair.findFirst({
      where: { state: 'running', OR: [{ incumbentId: botId }, { variantId: botId }] },
    });
    if (!running) return;

    throw new BadRequestException(
      `Refused: this bot is in a RUNNING A/B comparison testing ` +
        `"${running.declaredChange ?? 'an undeclared change'}". Changing ${behavioural.join(', ')} now ` +
        `would apply to a DIFFERENT configuration than the one being measured, so the result would ` +
        `describe neither side. Stop the comparison first ` +
        `(POST /api/trading/strategies/${botId}/pair/stop) (#963).`,
    );
  }

  /**
   * assertCeilingAllowsActivation() — refuse to activate a bot that can NEVER fire (#905).
   *
   * The measurement is the protocol's all-time maximum `compositePct` (the SAME percentage
   * the gate compares `minComposite` against — see `ProtocolHealthService.measureProtocolCeiling()`,
   * which shares its arithmetic with the health audit).
   *
   * Why refuse rather than warn: a bot with a bar its protocol has never reached is not a risky
   * bot, it is a DECORATIVE one — it occupies a config slot, scores every tick, writes queue
   * entries, and "SKIPs" with a plausible reason, while being mathematically incapable of
   * trading. The owner's trading-readiness bar (#910): *every active bot either can trade, or
   * the reason it cannot is on a surface an operator reads*. A refused activation IS that
   * surface, delivered at the moment the mistake is made.
   *
   * ⚠️ FAIL-OPEN on cannot-judge, deliberately: no history (< 10 readings), unknown protocol,
   * or a measurement failure all ALLOW the activation. Refusing on an unmeasurable protocol
   * would block new protocols from being tried — the defect being fixed is a false GREEN, and
   * the fix must not become a false RED.
   */
  private async assertCeilingAllowsActivation(
    protocolId: string,
    minComposite: number | null | undefined,
    botName: string,
  ): Promise<void> {
    if (!protocolId) return;
    const bar = minComposite ?? BOT_BAR_DEFAULT;
    const measured = await this.protocolHealth.measureProtocolCeiling(protocolId);
    if (!measured || measured.samples < 10) return;
    if (measured.ceilingPct >= bar) return;

    throw new BadRequestException(
      `Refused: "${botName}" could never fire. Protocol ${measured.slug} has never produced ` +
        `more than ${measured.ceilingPct.toFixed(1)}% of its capacity (raw ${measured.ceilingRaw} ` +
        `of ${measured.capacity}) across ${measured.samples} readings, and this bot's ` +
        `minComposite is ${bar}%. Lower minComposite below ${measured.ceilingPct.toFixed(1)}, ` +
        `fix the protocol's capacity, or keep the bot disabled (#905).`,
    );
  }

  // ── Core: Evaluate ────────────────────────────────────

  /**
   * Evaluate a strategy against current market data.
   * Returns the scoring result WITHOUT placing any trade.
   */
  async evaluate(strategyId: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id: strategyId } });
    if (!strategy) throw new Error('Strategy not found');

    const { symbol, protocolId, timeframe, minComposite, minRarityBand, requireDirection } = strategy;

    // Fetch bars from market data
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    if (!sym) {
      this.logger.warn(`Symbol ${symbol} not found in DB for strategy ${strategy.name}`);
      return { evaluated: false, reason: `Symbol ${symbol} not in database` };
    }

    const rows = await this.prisma.marketBar.findMany({
      where: { symbolId: sym.id, timeframe },
      orderBy: { timestamp: 'asc' },
      take: 200,
    });

    let bars: MarketBar[];

    if (rows.length < 30) {
      // ── MT5 Fallback (Sprint 2026-07-04) ──
      this.logger.warn(`Only ${rows.length} DB bars for ${symbol} — trying MT5 bridge`);
      const mt5Bars = await this.mt5.getCandles(symbol, timeframe, 200);
      if (mt5Bars.length >= 30) {
        // Store in DB for future use
        try {
          await this.prisma.marketBar.createMany({
            data: mt5Bars.map((b) => ({
              symbolId: sym.id, provider: 'mt5', timeframe,
              timestamp: b.timestamp, open: b.open, high: b.high,
              low: b.low, close: b.close, volume: b.volume,
            })),
            skipDuplicates: true,
          });
        } catch { /* ignore dupes */ }
        this.logger.log(`MT5 fallback: imported ${mt5Bars.length} bars for ${symbol}`);
        bars = mt5Bars;
      } else {
        return { evaluated: false, reason: `Only ${rows.length} DB bars + ${mt5Bars.length} MT5 bars (need 30+)` };
      }
    } else {
      bars = rows.map((r) => ({
        timestamp: r.timestamp, open: Number(r.open), high: Number(r.high),
        low: Number(r.low), close: Number(r.close), volume: Number(r.volume),
      }));
    }

    // Gated scoring — PROTOCOL-SCOPED (#531). The unscoped kitchen-sink
    // DIRECTIVE_GROUPS fallback was removed with the default protocol
    // (user policy: scoring without a protocol generates risky data).
    if (!protocolId) {
      this.logger.warn(`Strategy ${strategy.name} has no protocol linked — evaluation skipped`);
      return { evaluated: false, reason: 'No protocol linked' };
    }

    let gated: any;
    try {
      const { dayBars, hourBars, min15Bars } = await this.protocolGating.loadHigherTfBundle(sym.id, protocolId);
      gated = await this.protocolGating.scoreWithGating(symbol, bars, protocolId, { dayBars, hourBars, min15Bars });
    } catch (err) {
      this.logger.warn(`Protocol scoring failed for ${symbol}/${protocolId}: ${(err as Error).message}`);
      return { evaluated: false, reason: `Protocol scoring failed: ${(err as Error).message}` };
    }

    // Store the pre-gate percentage so the Strategy Monitor and the loop
    // speak the same scale (0-100, classification basis).
    const composite = Math.round(gated?.meta?.compositePct ?? gated?.composite ?? 0);
    const signal = gated?.signal ?? 'HOLD';
    const rarity = gated?.rarity ?? null;

    // Direction check
    let directionPassed = true;
    if (requireDirection && requireDirection !== 'BOTH') {
      const dirResult = this.getDirection(bars);
      directionPassed = dirResult === requireDirection;
    }

    // Threshold check
    const scoreOk = composite >= minComposite;
    const rarityOk = !minRarityBand || !rarity || rarityBandRank(rarity.band) >= rarityBandRank(minRarityBand);
    const passed = scoreOk && rarityOk && directionPassed;

    // Store evaluation
    const evaluation = await this.prisma.strategyEvaluation.create({
      data: {
        strategyId,
        symbol,
        composite,
        signal,
        rarityBand: rarity?.band ?? null,
        rarityPct: rarity?.percentile ?? null,
        direction: requireDirection ?? null,
        traded: false,
      },
    });

    return {
      evaluated: true,
      passed,
      evaluationId: evaluation.id,
      symbol,
      composite,
      signal,
      rarity: rarity ?? null,
      checks: {
        scoreOk: { passed: scoreOk, required: minComposite, actual: composite },
        rarityOk: { passed: rarityOk, required: minRarityBand ?? 'none', actual: rarity?.band ?? 'unknown' },
        directionOk: { passed: directionPassed },
      },
    };
  }

  // ── Core: Execute ─────────────────────────────────────

  /**
   * Evaluate AND execute a trade if conditions are met.
   * Respects mode: manual=log only, semi-auto=needs approval, auto=execute.
   */
  async execute(strategyId: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id: strategyId } });
    if (!strategy) throw new Error('Strategy not found');

    if (!strategy.active) {
      return { executed: false, reason: 'Strategy is not active' };
    }

    // Cooldown check
    const lastTrade = this.lastTradeTime.get(strategyId);
    if (lastTrade) {
      const elapsed = (Date.now() - lastTrade.getTime()) / 60000;
      if (elapsed < strategy.cooldownMinutes) {
        return { executed: false, reason: `Cooldown active — ${Math.ceil(strategy.cooldownMinutes - elapsed)}m remaining` };
      }
    }

    // Position limit check
    if (strategy.mode === 'auto') {
      // ⚠️ #1033 — EVERY BRIDGE. Counting only the primary account made this cap UNDER-COUNT, so
      // the bot was allowed MORE positions than `maxPositions` — the gate was permissive on the
      // account it could not see. Widening can only make it refuse more, never fewer.
      const positions = await this.mt5.getAllPositions();
      if (positions.length >= strategy.maxPositions) {
        return { executed: false, reason: `Max positions (${strategy.maxPositions}) reached` };
      }
    }

    // Evaluate
    const evalResult = await this.evaluate(strategyId);
    if (!evalResult.evaluated || !evalResult.passed) {
      return {
        executed: false,
        reason: evalResult.evaluated ? 'Conditions not met' : evalResult.reason,
        evaluation: evalResult,
      };
    }

    // Compute position size with regime adaptation
    let size = strategy.baseSize ?? 0.01;
    if (strategy.useRaritySizing && evalResult.rarity) {
      size *= evalResult.rarity.sizeMultiplier;
    }

    // ── Regime-Adaptive Sizing (Sprint 2026-07-04) ──
    let regimeMultiplier = 1.0;
    let regimeLabel = 'normal';
    try {
      const condition = this.conditionDetector.detect({
        symbol: strategy.symbol,
        bars: [], // ConditionDetector falls back to defaults if no bars
      });
      if (condition.volatility === 'high') {
        regimeMultiplier = 0.5;  // Half-size in high vol
        regimeLabel = 'high vol — half size';
      } else if (condition.regime === 'chaotic') {
        regimeMultiplier = 0.25; // Quarter-size in chaos
        regimeLabel = 'chaotic — quarter size';
      } else if (condition.regime === 'trending' && condition.regimeStrength > 0.7) {
        regimeMultiplier = 1.25; // 25% boost in strong trends
        regimeLabel = 'strong trend — 1.25× size';
      }
    } catch { /* keep default 1.0 */ }
    size *= regimeMultiplier;
    // ── End regime-adaptive sizing ──

    if (strategy.maxSize) {
      size = Math.min(size, strategy.maxSize);
    }
    size = Math.round(size * 10000) / 10000; // Round to 4 decimals

    // Never dispatch a zero/negative volume order. Rarity sizing (black-swan
    // band) intentionally multiplies size by 0 — skip the trade instead of
    // sending an invalid 0-lot order to the broker.
    if (size <= 0) {
      this.logger.warn(`Trade skipped for ${strategy.symbol}: position size ${size} (invalid after sizing)`);
      return {
        executed: false,
        reason: 'Position size is 0 after sizing (e.g. black-swan rarity) — trade skipped',
        signal: evalResult.signal,
        composite: evalResult.composite,
        suggestedSize: 0,
        evaluationId: evalResult.evaluationId,
      };
    }

    // Mode dispatch
    if (strategy.mode === 'manual') {
      // Log only — human must execute
      await this.prisma.strategyEvaluation.update({
        where: { id: evalResult.evaluationId },
        data: { tradeResult: 'Manual mode — awaiting human execution' },
      });
      return {
        executed: false,
        reason: 'Manual mode — signal logged. Execute manually.',
        signal: evalResult.signal,
        composite: evalResult.composite,
        suggestedSize: size,
        evaluationId: evalResult.evaluationId,
      };
    }

    // Auto / semi-auto: place bracket order with trailing stop
    const entryPrice = 0; // Market order — MT5 fills at best available
    const slPct = (strategy.slPct ?? 1.0) / 100;
    const tpPct = (strategy.tpPct ?? 1.0) / 100;

    // ── Pre-Flight Safety Gates (Issue #28) ──────────────
    const safetyCheck = await this.assessGlobalRiskLimits(size, strategy.symbol);
    if (!safetyCheck.allowed) {
      return { executed: false, reason: safetyCheck.reason };
    }
    // ── End safety gates ──

    // ── Post-entry exit management (#936) ──
    //
    // ⚠️ THIS BLOCK USED TO ANNOUNCE A TRAILING STOP THAT NOTHING ARMED — the numbers are now
    // DELETED, not wired. Measured 2026-09-21: it computed `0.75 × slPct` and `1.5 × slPct`, wrote
    // them into the entry notification AND the persisted `strategyEvaluation.tradeResult`, and
    // returned a `trailingStop` object — while `placeOrder()` above sends NO trailing parameter
    // and no consumer of that object existed anywhere in `nest/src` or `src/**`. The only real
    // trail is `StopGuardianService` (distance `max(3 × ATR, declared)`, no profit activation).
    //
    // So every auto entry told the user and the record that a 0.75×SL trailing stop was in place
    // when none was. Same class as #913 — a declared mechanism with no implementation behind it.
    //
    // ⚠️ WHY DELETED RATHER THAN WIRED: arming them would change how REAL positions are managed,
    // which is a MATHS change needing a copied configuration plus a monitored comparison
    // (maths-change-requires-ab; #929 blocks the comparison today). The per-bot simulated TSL
    // (`simTslEnabled` / `simTslActivationPct` / `simTslDistancePct`, #936 R20=A) now EXISTS as an
    // OBSERVER instead — the guardian records decision moments in `sim_tsl_event` and moves no
    // stop, so the capability is measurable before it is allowed to touch a trade.

    const slPrice = evalResult.signal === 'BUY'
      ? entryPrice > 0
        ? entryPrice * (1 - slPct)
        : 0 // Will be set by MT5 based on current market
      : entryPrice > 0
        ? entryPrice * (1 + slPct)
        : 0;

    const tpPrice = evalResult.signal === 'BUY'
      ? entryPrice > 0
        ? entryPrice * (1 + tpPct)
        : 0
      : entryPrice > 0
        ? entryPrice * (1 - tpPct)
        : 0;

    const orderType = evalResult.signal === 'BUY' ? 'BUY' : 'SELL';

    try {
      const result = await this.mt5.placeOrder({
        symbol: strategy.symbol,
        type: orderType as 'BUY' | 'SELL',
        volume: size,
        sl: slPrice,
        tp: tpPrice,
        // Name only — the shared sanitizer strips '|' and '%', so embedding
        // "| composite%" pollutes the strategy name parsed back on close.
        comment: `TCS ${strategy.name}`,
        clientOrderId: `strategy-${strategy.id}-${evalResult.evaluationId}`,
      });

      this.lastTradeTime.set(strategyId, new Date());

      // ── Signal Alert (Sprint 2026-07-04) ──
      if (result.success) {
        this.notificationService.send({
          event: 'entry-signal',
          title: `${orderType} ${strategy.symbol}`,
          body: [
            `Signal: ${evalResult.signal} @ ${evalResult.composite}%`,
            `Size: ${size} (${regimeLabel})`,
            `SL/TP: ${slPct * 100}% / ${tpPct * 100}%`,
            `Rarity: ${evalResult.rarity?.band ?? 'standard'}`,
            `Strategy: ${strategy.name}`,
          ].join(' | '),
        }).catch(() => {}); // Fire-and-forget
      }
      // ── End signal alert ──

      await this.prisma.strategyEvaluation.update({
        where: { id: evalResult.evaluationId },
        data: {
          traded: result.success,
          tradeTicket: result.ticket ?? null,
          tradeResult: result.success
            ? [
                `Order: ticket ${result.ticket}, size ${size} (${regimeLabel})`,
                `SL/TP: ${slPct * 100}% / ${tpPct * 100}% — post-entry managed by StopGuardianService`,
              ].join(' | ')
            : `Order failed: ${result.error}`,
        },
      });

      return {
        executed: result.success,
        ticket: result.ticket ?? null,
        symbol: strategy.symbol,
        type: orderType,
        size,
        slPrice,
        tpPrice,
        composite: evalResult.composite,
        signal: evalResult.signal,
        rarity: evalResult.rarity?.band ?? null,
        regimeSizing: { multiplier: regimeMultiplier, label: regimeLabel },
      };
    } catch (err: any) {
      this.logger.error(`Trade execution failed: ${err.message}`);
      return { executed: false, reason: err.message };
    }
  }

  /**
   * Pre-flight safety gates before any MT5 order.
   * Checks settings-driven risk limits + RiskService portfolio gates.
   *
   * ⚠️ `symbol` is REQUIRED as of 2026-09-18 (#865). The per-symbol allocation cap cannot be
   * evaluated without knowing which instrument is being priced — the old signature took only a
   * size, which is how `size × 100_000` came to be applied to gold and to a yen cross alike.
   */
  async assessGlobalRiskLimits(
    size: number,
    symbol: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    // ── 1. MT5_MAX_POSITION_SIZE ──
    const maxPosSize = await this.settings.get<number>('risk.maxPositionSize');
    if (size > maxPosSize) {
      return { allowed: false, reason: `Position size ${size} exceeds risk.maxPositionSize (${maxPosSize})` };
    }

    // ── 2. MT5_MAX_OPEN_POSITIONS ──
    const maxOpenPositions = await this.settings.get<number>('risk.maxOpenPositions');
    try {
      // ⚠️ #1033 — EVERY BRIDGE. Under-counting a position CAP permits more than it allows, and the
      // second account's positions were invisible to it. It also feeds the #900 unprotected-position
      // check below, so those positions are now examined for a missing stop rather than skipped.
      // Widening can only make this gate refuse more, never fewer.
      const positions = await this.mt5.getAllPositions();
      if (positions.length >= maxOpenPositions) {
        return { allowed: false, reason: `risk.maxOpenPositions (${maxOpenPositions}) reached — ${positions.length} currently open` };
      }

      // ── 2b. UNPROTECTED POSITIONS (#900, 2026-09-19) ──────────────────────────────────────
      // The owner's rule: "if … the distant broker stop loss is missing … then it doesn't trade."
      // docs/trading-bot-model.md §6b requires a broker-side protective stop on EVERY position so
      // an app failure never leaves one unprotected — that invariant was asserted at order-building
      // and NEVER verified afterwards (a dropped modify, a partial fill, a manual MT5 edit all
      // leave it broken with no error anywhere). Checked here on every entry, against every open
      // position, on the SAME broker fetch the count check above already made.
      //
      // ⚠️ `!== false` — anything but an explicit false enforces the check. An unreadable setting
      // must not remove a money gate (the #865 lesson: a cap that arrives `undefined` DISABLES its
      // check silently). The bridge being unreachable lands in the catch below, where trading is
      // separately impossible — an order cannot be placed through a dead bridge.
      const requireBrokerStopLoss = await this.settings.get<boolean>('risk.requireBrokerStopLoss');
      if (requireBrokerStopLoss !== false) {
        const naked = positions.filter((p) => !(Number(p.sl) > 0));
        if (naked.length > 0) {
          return {
            allowed: false,
            reason:
              `Unprotected position(s): ${naked.map((p) => `#${p.ticket} ${p.symbol} (SL ${p.sl ?? 0})`).join(', ')} ` +
              '— no broker stop loss. §6b requires every position to carry a broker-side stop; ' +
              'refusing to add risk while one is unprotected (risk.requireBrokerStopLoss, #900).',
          };
        }
      }
    } catch { /* MT5 may be unreachable — proceed with caution */ }

    // ── 3. MT5_MAX_DAILY_LOSS ──
    //
    // ⚠️ THE MESSAGE NAMES THE UNIT BECAUSE IT DOES NOT KNOW THE CURRENCY — and it must not pretend.
    // It read `Daily loss $${…} exceeds risk.maxDailyLoss ($${…})`, and the `$` was a LIE: both live
    // accounts are **GBP** (`GET :5000/account` → `currency=GBP`, `:5001` → `currency=GBP`), so the
    // operator was shown £270.72 labelled as dollars — a wrong unit on a money figure, in the reason
    // string that the risk-cap alerts now QUOTE VERBATIM (#1086). A symbol that is never checked is a
    // claim, so it is gone; `[account currency]` says what is actually known.
    //
    // ⚠️ TWO REACHABLE LIMITATIONS, STATED RATHER THAN HIDDEN:
    //   1. THE SUM SPANS EVERY MT5 ACCOUNT. The query filters on `provider: 'mt5'` with NO broker
    //      filter, and `trade` has no account column at all, so both bridges' P&L is added into one
    //      pot — a loss on broker 3 blocks broker 2. That is deliberate for a single book, but it is
    //      the reason this cannot be read as a per-account figure.
    //   2. IT ASSUMES ONE CURRENCY. Summing raw `pnl` across accounts is only valid while those
    //      accounts share a currency, and nothing checks that. Both live accounts are GBP today, so
    //      this is REACHABLE, not active — but the owner's stated direction is *"prepare for many
    //      users that will input different accounts"* (`external-systems-are-data`), and the first
    //      account in a second currency makes this sum meaningless without a conversion. Not fixed
    //      here: it needs the conversion the margin estimator already has, and it is a money-path
    //      change that deserves its own comparison rather than being folded into a message fix.
    const maxDailyLoss = await this.settings.get<number>('risk.maxDailyLoss');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const trades = await this.prisma.trade.findMany({
        where: {
          provider: 'mt5',
          closedAt: { gte: today },
          pnl: { not: null },
        },
        select: { pnl: true },
      });
      const dailyPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      if (dailyPnl < -maxDailyLoss) {
        // ⚠️ `[account currency]` on BOTH figures — the cap is declared in the same unit as the P&L
        // it is compared against, so labelling one and not the other would invite the same mistake.
        return { allowed: false, reason: `Daily loss ${Math.abs(dailyPnl).toFixed(2)} exceeds risk.maxDailyLoss (${maxDailyLoss}) [account currency]` };
      }
    } catch { /* DB may be unavailable */ }

    // ── 4. RiskService portfolio gates ──
    //
    // ⚠️ These two caps are read OUTSIDE the try block below, deliberately. Inside it, a settings
    // failure would be swallowed by the catch — which logs "proceeding with caution" and lets the
    // order through. That would turn a broken settings read into a SILENTLY DISABLED risk cap, which
    // is the exact defect shape this file keeps producing. Outside, it is visible here. (#865)
    const maxPerSymbol = await this.settings.get<number>('risk.maxPerSymbol');
    const maxDrawdown = await this.settings.get<number>('risk.maxDrawdown');
    // #900 — live since 2026-09-19; declared with NO READER ANYWHERE before that (see the register).
    const maxPortfolioRisk = await this.settings.get<number>('risk.maxPortfolioRisk');

    // ⚠️ FAIL CLOSED ON AN UNREADABLE CAP (2026-09-17).
    //
    // `allocation > undefined` is `false` and `drawdown >= undefined` is `false`, so a cap that
    // arrives as `undefined` does not block the trade — it REMOVES the block, silently. Discovered
    // by a test fixture that was missing two keys: the drawdown gate stopped firing altogether and
    // nothing in the log said so.
    //
    // A cap we cannot read is a cap we cannot honour, so the trade is refused with a reason that
    // NAMES the key. Refusing is the safe direction: this is a money path, and "we could not
    // evaluate the limit" must never render as "the limit is fine" (development-philosophy §7).
    const unreadableCaps = (
      [
        ['risk.maxOpenPositions', maxOpenPositions],
        ['risk.maxPerSymbol', maxPerSymbol],
        ['risk.maxDrawdown', maxDrawdown],
        ['risk.maxPortfolioRisk', maxPortfolioRisk],
      ] as [string, unknown][]
    ).filter(([, v]) => typeof v !== 'number' || !Number.isFinite(v));
    if (unreadableCaps.length > 0) {
      return {
        allowed: false,
        reason:
          `Risk cap(s) unreadable: ${unreadableCaps.map(([k]) => k).join(', ')} — refusing the order ` +
          'rather than trading without them',
      };
    }

    try {
      const positions = await this.mt5.getPrimaryPositions().catch(() => []);
      const account = await this.mt5.getAccount().catch(() => null);

      // ⚠️ A DRAWDOWN CANNOT BE MEASURED WITHOUT A REAL ACCOUNT VALUE (#848, 2026-09-16).
      //
      // This line used to read `account?.equity ?? account?.balance ?? 10_000`. That fabricated
      // $10,000 then seeded `peakEquity`, which is MONOTONIC — so the fabricated value became a
      // permanent high-water mark and the REAL account looked like a catastrophic loss:
      //
      //   measured live 2026-09-16
      //     08:28-18:40  bridge unreachable — 707 FAILED decisions; account=null -> peak = 10,000
      //     ~18:40       bridge recovers (both bridges connected=true)
      //     18:42, 18:44 EURCAD/NZDJPY/EURCHF/GBPCAD blocked: "Drawdown 86.1% exceeds limit"
      //     arithmetic   (10_000 - 1,389.37) / 10_000 = 86.11%   <- the logged figure, exactly
      //
      // So the gate failed CLOSED on a number it invented, and stayed that way until the process
      // restarted (the field is in-memory and only ever increases). Worse, it was the bridge
      // RECOVERING that triggered the block — the system got worse as infrastructure got better.
      //
      // Skipping the gate is the honest behaviour: there is no drawdown to evaluate. Bridge-down is
      // already handled by the circuit breaker and the FAILED decision path, so nothing is lost.
      // The position-capital check is skipped with it, deliberately: if the account is unreadable
      // then `getPositions()` also fell back to `[]`, and counting 0 open positions would
      // under-count against `maxPositions` — a second fabricated answer from the same outage.
      const realAccountValue = account?.equity ?? account?.balance ?? null;

      if (realAccountValue === null) {
        this.logger.warn(
          'Portfolio risk gates SKIPPED — MT5 account value unavailable (bridge unreachable?). ' +
            'No peak recorded: a fabricated value would become a permanent high-water mark and ' +
            'block every subsequent trade (#848).',
        );
      } else {
        const portfolioValue = realAccountValue;

        // ── Per-symbol capital estimate (#865, 2026-09-18) ──────────────────────────────────
        //
        // Replaces `(size × 100_000) / (balance / margin)`, which had two defects:
        //
        //   1. NO PRICE AND NO CONTRACT SIZE. `size × 100_000` is the FX convention applied to
        //      everything, so XAUUSD and NZDJPY produced the IDENTICAL estimate — visible in the
        //      logs as `62.7%` and `62.6%` for gold and a yen cross.
        //   2. `balance / margin` is margin UTILISATION (8.62 here), not the account's 1:100. It
        //      inflated every estimate ~11x AND fell as positions opened, so the more was open the
        //      harder entries were blocked: a compounding trap. It cost 78 trades in one day.
        //
        // The formula, and the live-account measurement that proves it (96.02 computed vs 95.98
        // actual), live in `common/trading/position-margin.ts`.
        //
        // ⚠️ IT FAILS CLOSED. Every input is read or the order is refused with the missing input
        // NAMED. This is the whole point: the old defect was not a wrong number, it was a wrong
        // number that looked normal — and a cap that arrives as `undefined` does not trip a check,
        // it DISABLES it.
        const symbolUpper = symbol.toUpperCase();

        // ⚠️ THE ENTIRE ESTIMATE IS WRAPPED, AND THE CATCH REFUSES — deliberately.
        //
        // This code sits inside the portfolio-gate `try`, whose catch logs "proceeding with
        // caution" and lets the order through. That is correct for an unavailable ACCOUNT reading
        // (handled above) but WRONG for the per-symbol cap: a throw here would silently DISABLE the
        // cap and the trade would look like it passed. Found exactly that way — a test double
        // without `getSymbolInfo` made the method throw, the outer catch swallowed it, and a gate
        // expected to block returned `allowed: true`.
        //
        // An error we do not understand is a cap we cannot evaluate, so it refuses and says so.
        let marginEstimate: ReturnType<typeof estimatePositionMargin>;
        // #899 — capital already committed to THIS symbol (sum of open positions). Filled inside
        // the inner try below; the gate compares existing + new against maxPerSymbol so three bots
        // on one symbol cannot each pass a 25% cap and total 60%.
        let existingSymbolCapital = 0;
        try {
          // ⚠️ NO `.catch(() => null)` HERE, deliberately. Both methods already wrap their own
          // fetch and return `null` on a network failure, so an outer catch would only swallow
          // GENUINE faults — turning "the bridge exploded" into a bland "contractSize is 0" and
          // losing the message that would have explained it. A real fault should reach the catch
          // below, which refuses and quotes it.
          const symbolInfo = await this.mt5.getSymbolInfo(symbol);
          const symbolQuote = await this.mt5.getQuote(symbol);

          // Profit currency, most authoritative first: broker spec → an open position of this
          // symbol (MT5's own value) → the documented XXXYYY convention. Never a guess.
          const profitCurrency =
            symbolInfo?.currencyProfit?.toUpperCase() ??
            positions.find((p) => String(p.symbol).toUpperCase() === symbolUpper)?.currencyProfit?.toUpperCase() ??
            resolveProfitCurrency(symbol) ??
            undefined;

          // This broker quotes ONE direction per pair (GBPUSD, GBPJPY — no USDGBP/JPYGBP), so fetch
          // both candidates and let the estimator pick; it inverts when only the reverse exists.
          const quotes: Record<string, number> = {};
          if (profitCurrency && account?.currency) {
            for (const pair of conversionPairsNeeded(profitCurrency, account.currency)) {
              const q = await this.mt5.getQuote(pair);
              if (q?.last) quotes[pair] = q.last;
            }
          }

          marginEstimate = estimatePositionMargin({
            symbol,
            volume: size,
            price: symbolQuote?.last ?? 0,
            contractSize: symbolInfo?.contractSize ?? 0,
            accountLeverage: account?.leverage ?? 0,
            accountCurrency: account?.currency ?? '',
            profitCurrency,
            quotes,
            // ⚠️ Index CFDs (`US500`, `GER40`, `UK100`, `FRA40`) carry no currency in their name and
            // the running bridge does not report `currencyProfit`, so without this they were refused
            // outright and their queue entries went nowhere. The fallback is labelled in the estimate
            // and in `describeMargin()`, and is up-rated by ASSUMED_CURRENCY_SAFETY_FACTOR so the cap
            // can only be too strict — never too loose. It stops being used the moment MT5 reports
            // the real value.
            assumeAccountCurrencyWhenUnknown: true,
          });

          // ── #899: existing exposure on this symbol ──────────────────────────────────────
          // The cap's OTHER half. `marginEstimate` above measures THIS order; without this
          // sum, "maxPerSymbol = 25%" really meant "25% per order" and Bot A + Bot B + Bot C
          // could pile 60% onto one instrument while every check passed. The owner's design is
          // one protocol driving several bots on the same symbol, with the explicit constraint
          // "…not increasing risk" — this is that constraint, enforced.
          //
          // Same estimator, same inputs, same fail-closed discipline as the incoming order:
          // an existing position that cannot be measured makes the TOTAL unknowable, so we
          // refuse (the throw below is caught by the inner catch, which refuses and quotes it).
          for (const p of positions) {
            if (String(p.symbol).toUpperCase() !== symbolUpper) continue;
            const posEstimate = estimatePositionMargin({
              symbol,
              volume: p.volume,
              price: p.price_current > 0 ? p.price_current : (symbolQuote?.last ?? 0),
              contractSize: p.contractSize ?? symbolInfo?.contractSize ?? 0,
              accountLeverage: account?.leverage ?? 0,
              accountCurrency: account?.currency ?? '',
              profitCurrency,
              quotes,
              assumeAccountCurrencyWhenUnknown: true,
            });
            if (posEstimate.source === 'unavailable') {
              throw new Error(
                `existing ${symbol} position #${p.ticket} could not be measured (${posEstimate.reason})`,
              );
            }
            existingSymbolCapital += posEstimate.margin;
          }
        } catch (err: any) {
          this.logger.error(
            `Per-symbol cap could not be evaluated for ${symbol}: ${err?.message ?? err}`,
          );
          return {
            allowed: false,
            reason:
              `Cannot evaluate the per-symbol cap for ${symbol}: ${err?.message ?? err} — ` +
              'refusing rather than trading without it',
          };
        }

        if (marginEstimate.source === 'unavailable') {
          this.logger.warn(
            `Cannot estimate capital for ${symbol} ${size} lot — ${marginEstimate.reason}. ` +
              'Refusing rather than trading without the per-symbol cap (#865).',
          );
          return {
            allowed: false,
            reason:
              `Cannot evaluate the per-symbol cap for ${symbol}: ${marginEstimate.reason} — ` +
              'refusing rather than trading without it',
          };
        }

        const estimatedCapital = marginEstimate.margin;

        this.logger.debug(
          `risk estimate for ${symbol}: ${describeMargin(marginEstimate, account?.currency ?? '')} = ` +
            `${portfolioValue > 0 ? ((estimatedCapital / portfolioValue) * 100).toFixed(1) : '?'}% of ${portfolioValue}`,
        );

        const riskProfile = buildRiskProfile({
          maxOpenPositions,
          maxPerSymbol,
          maxDrawdown,
          maxPortfolioRisk,
        });

        const posCheck = this.riskService.canOpenPosition(
          positions.length,
          portfolioValue,
          estimatedCapital,
          riskProfile,
          // #899 — the gate measures the SYMBOL (existing + this order), not just this order.
          existingSymbolCapital,
        );
        if (!posCheck.allowed) {
          return { allowed: false, reason: posCheck.reason };
        }

        // Drawdown check — track peak equity (only increases) so drawdown is real.
        // Previously peak was hardcoded to current equity, making drawdown always 0%
        // and permanently disabling the maxDrawdown: 0.25 risk limit.
        // ⚠️ `portfolioValue` here is a REAL account reading — never a fallback (#848), and the
        // only writer of `peakEquity` is `nextPeakEquity()`, which refuses to move on a null
        // reading. Do not inline the comparison again — the spec canaries the rule.
        this.peakEquity = nextPeakEquity(this.peakEquity, portfolioValue);
        const drawdownCheck = this.riskService.checkDrawdown(
          this.peakEquity,
          portfolioValue,
          riskProfile,
        );
        if (drawdownCheck.inDrawdown) {
          return { allowed: false, reason: `Drawdown ${(drawdownCheck.drawdownPercent * 100).toFixed(1)}% exceeds limit` };
        }

        // ── #900: THE BOOK ITSELF — total at risk if every stop filled ──
        //
        // Every gate above asks a question about the INCOMING ORDER. This one asks whether the
        // book is currently safe to ADD to: Σ |entry − brokerSL| × volume × contractSize over all
        // open positions, converted to account currency. That is maxPortfolioRisk's definition —
        // "X% is in red on current positions" from the owner's brief — and it is NOT the same
        // question as maxDrawdown (peak-to-current on realised+unrealised equity), which a book
        // of losing positions can sail under indefinitely having never breached the peak.
        //
        // ⚠️ FAIL CLOSED. An unmeasurable position makes the TOTAL unknowable, and an
        // unknowable total must never read as "under the cap" (the #865/#848 lesson).
        const bookRisk = await this.assessBookAtRisk(positions, account);
        if (bookRisk.available === false) {
          return {
            allowed: false,
            reason:
              `Cannot evaluate portfolio-at-risk: ${bookRisk.reason} — refusing rather than ` +
              'trading without it (risk.maxPortfolioRisk, #900)',
          };
        }
        const bookFraction = portfolioValue > 0 ? bookRisk.atRisk / portfolioValue : 0;
        this.logger.debug(
          `book at risk ${bookRisk.atRisk.toFixed(2)} ${account?.currency ?? ''} ` +
            `(${(bookFraction * 100).toFixed(1)}% of ${portfolioValue.toFixed(2)}) vs cap ` +
            `${(riskProfile.maxPortfolioRisk * 100)}% — ${bookRisk.detail}`,
        );
        if (bookFraction > riskProfile.maxPortfolioRisk) {
          return {
            allowed: false,
            reason:
              `Portfolio at risk ${(bookFraction * 100).toFixed(1)}% exceeds risk.maxPortfolioRisk ` +
              `${(riskProfile.maxPortfolioRisk * 100)}% — ${bookRisk.detail}. ` +
              'Measured as the loss if every broker stop filled (#900).',
          };
        }
      }
    } catch (err: any) {
      this.logger.warn(`Risk gate check failed: ${err.message} — proceeding with caution`);
    }

    return { allowed: true, reason: 'All safety gates passed' };
  }

  /**
   * assessBookAtRisk() — Σ over OPEN positions of the loss if the position's broker stop fills.
   * ================================================================================
   * The maxPortfolioRisk definition (#900): |price_open − SL| × volume × contractSize, converted
   * to the account currency, summed over every open position, compared to portfolio value by the
   * caller. This answers "is the book currently safe to add to?" — the question NO gate asked
   * before: every other entry gate inspects the incoming ORDER, not the state already held.
   *
   * ⚠️ FAIL CLOSED, and name the position that could not be measured. An unmeasurable position
   * makes the total unknowable; an unknowable total that reads as "under the cap" is exactly the
   * #865 failure shape (a cap that silently stops blocking). The reason quotes the ticket, the
   * symbol and the missing input.
   *
   * ⚠️ NAKED POSITIONS PRICED AT FULL NOTIONAL. A position with no broker SL has no bounded loss;
   * the full notional is the conservative stand-in. This is only reachable when
   * `risk.requireBrokerStopLoss` is set false — the naked gate in assessGlobalRiskLimits refuses
   * first otherwise — and the detail string says "NO SL" so the figure is explicable.
   *
   * One caveat, stated because it is a claim the code cannot make: this measures the loss IF THE
   * STOP FILLS, at the STOP's price. Slippage, gaps and weekend jumps can exceed it.
   */
  private async assessBookAtRisk(
    positions: Array<{
      ticket?: number;
      symbol?: string;
      volume?: number;
      price_open?: number;
      price_current?: number;
      sl?: number;
      contractSize?: number;
      currencyProfit?: string;
    }>,
    account: { currency?: string } | null,
  ): Promise<
    | { available: true; atRisk: number; detail: string }
    | { available: false; reason: string }
  > {
    if (positions.length === 0) return { available: true, atRisk: 0, detail: 'no open positions' };

    const accountCurrency = (account?.currency ?? '').toUpperCase();
    if (!accountCurrency) return { available: false, reason: 'account currency not reported' };

    const quoteCache: Record<string, number> = {};
    const infoCache = new Map<string, { contractSize?: number; currencyProfit?: string } | null>();
    const parts: string[] = [];
    let atRisk = 0;

    for (const p of positions) {
      const symbol = String(p.symbol ?? '');
      const ticket = p.ticket ?? '?';

      // Per-symbol contract size. Positions usually carry it (mapped since #865); the symbol
      // lookup is the fallback, cached per symbol so N positions on one symbol cost one call.
      let contractSize = Number(p.contractSize ?? 0);
      if (!(contractSize > 0)) {
        const key = symbol.toUpperCase();
        if (!infoCache.has(key)) infoCache.set(key, await this.mt5.getSymbolInfo(symbol));
        contractSize = Number(infoCache.get(key)?.contractSize ?? 0);
      }
      if (!(contractSize > 0)) {
        return { available: false, reason: `contract size unavailable for ${symbol} (position #${ticket})` };
      }

      // Profit currency, then its rate to the account currency. Same resolution order as the
      // incoming-order estimator: position's own value (MT5's) → the symbol's info → XXXYYY.
      const info = infoCache.get(symbol.toUpperCase()) ?? null;
      const profitCurrency = (
        p.currencyProfit ?? info?.currencyProfit ?? resolveProfitCurrency(symbol) ?? ''
      ).toUpperCase();

      let rate = 1;
      let rateLabel = 'same-currency';
      if (!profitCurrency) {
        // Unlabelled instrument (e.g. an index CFD with no currencyProfit anywhere). The same
        // assumption the incoming-order estimate makes, up-rated so it can only be too STRICT.
        rate = ASSUMED_CURRENCY_SAFETY_FACTOR;
        rateLabel = `assumed ${accountCurrency}×${ASSUMED_CURRENCY_SAFETY_FACTOR}`;
      } else if (profitCurrency !== accountCurrency) {
        for (const pair of conversionPairsNeeded(profitCurrency, accountCurrency)) {
          if (quoteCache[pair] === undefined) {
            const q = await this.mt5.getQuote(pair);
            quoteCache[pair] = typeof q?.last === 'number' && q.last > 0 ? q.last : NaN;
          }
        }
        const usable = Object.fromEntries(
          Object.entries(quoteCache).filter(([, v]) => Number.isFinite(v)),
        );
        const conv = conversionFor(profitCurrency, accountCurrency, usable);
        if (!conv) {
          return {
            available: false,
            reason: `no conversion rate ${profitCurrency}→${accountCurrency} for position #${ticket} ${symbol}`,
          };
        }
        rate = conv.rate;
        rateLabel = conv.source;
      }

      const volume = Number(p.volume ?? 0);
      const openPrice = Number(p.price_open ?? 0);
      const sl = Number(p.sl ?? 0);
      let riskInProfitCurrency: number;
      let basis: string;
      if (sl > 0) {
        riskInProfitCurrency = Math.abs(openPrice - sl) * volume * contractSize;
        basis = `#${ticket} ${symbol} |entry−SL|×vol×contract`;
      } else {
        riskInProfitCurrency = volume * contractSize * (Number(p.price_current ?? 0) || openPrice);
        basis = `#${ticket} ${symbol} NO SL — full notional`;
      }

      const riskAccount = riskInProfitCurrency * rate;
      atRisk += riskAccount;
      parts.push(`${basis} = ${riskAccount.toFixed(2)} ${accountCurrency} (${rateLabel})`);
    }

    return {
      available: true,
      atRisk,
      // Bounded for the log/reason: 5 positions verbatim, then a count. A 20-position book must
      // not produce a reason nobody reads.
      detail: parts.length <= 5 ? parts.join('; ') : `${parts.slice(0, 5).join('; ')}; +${parts.length - 5} more`,
    };
  }

  // ── Helpers ───────────────────────────────────────────

  /**
   * Evaluate all active strategies. Intended to be called by
   * TradingSchedulerService or triggered manually via API.
   */
  async evaluateAllActive() {
    const strategies = await this.prisma.tradingStrategy.findMany({
      where: { active: true },
    });
    if (strategies.length === 0) return { evaluated: 0 };

    this.logger.log(`Evaluating ${strategies.length} active strategy(s)...`);
    let count = 0;
    for (const strategy of strategies) {
      try {
        if (strategy.mode === 'auto') {
          await this.execute(strategy.id);
        } else {
          await this.evaluate(strategy.id);
        }
        count++;
      } catch (err: any) {
        this.logger.error(`Strategy ${strategy.name}: ${err.message}`);
      }
    }
    return { evaluated: count };
  }

  private getDirection(bars: MarketBar[]): string {
    if (bars.length < 5) return 'HOLD';
    const recent = bars.slice(-5);
    const first = recent[0].close;
    const last = recent[recent.length - 1].close;
    if (last > first * 1.002) return 'BUY';
    if (last < first * 0.998) return 'SELL';
    return 'HOLD';
  }

  /**
   * Seed default trading strategies from seed data.
   *
   * ⚠️ CONVERGENT, NOT CREATE-ONLY (#833, fixed 2026-09-23).
   *
   * This used to `continue` past any bot that already existed, so the seeder could only ever
   * INITIALISE a database, never repair one. The measured consequences:
   *   • a seed edit had **no effect on a live bot** — correcting four sizes and five modes
   *     required 13 hand-made `PATCH /api/trading/strategies/:id` calls, and editing
   *     `strategy-seed-data.ts` alone changed nothing at all;
   *   • a deliberately wrong value **survived** a re-seed (`{"created":0,"skipped":27}`),
   *     reproduced live on `Gold Swing 1H baseSize = 0.99`;
   *   • 8 `forex-session-v1` bots exist **only in the database** ("DB activation only, no code
   *     change") and would be lost on a reinstall with no way to re-seed them.
   *
   * The seed file is the durable artefact — it is in git, the database is not. So the seeder's job
   * is to bring the database BACK to the seed, not merely to populate an empty one.
   *
   * It also REPAIRS queue routing: `SignalQueueService.syncQueues()` routes by `strategy_protocol`,
   * never by `trading_strategy`, so a bot that has lost its subscription can receive no signal and
   * can never trade while still looking active in the UI. The create path has always written one;
   * this path now does too, or a re-seed could not revive a bot it had itself described.
   *
   * Idempotent: converging an already-correct row writes nothing and is reported as `unchanged`.
   */
  async seedDefaults(strategies: Array<{
    name: string; symbol: string; protocolId: string;
    brokerId: string; mode: string; timeframe: string;
    baseSize: number; slPct: number; tpPct: number; minComposite: number; magic?: number;
    /** Session gate window (see session-window.ts). null/absent = ungated. */
    sessionWindow?: string[] | null;
    /**
     * Direction the bot may act on ('BUY' | 'SELL'). null/absent = unconstrained.
     * Required for SHORT_ONLY protocols so a seeded short bot cannot open longs.
     */
    requireDirection?: string | null;
    /**
     * Whether the bot starts enabled. Absent = true (the historical behaviour).
     *
     * Added 2026-09-15 so the seed can be a FAITHFUL copy of the database: without it,
     * a deliberately-INACTIVE bot (the `hourly-3dir-v1` A/B control) came back active on
     * a fresh install, and "inactive on purpose" was indistinguishable from "lost".
     */
    active?: boolean;
    /**
     * Position time-stop in HOURS (#773). null/absent = NO LIMIT.
     *
     * Carried by this seeder because it is a slot-releasing control: 11 auto bots shared
     * 5 broker-wide slots and nothing freed them until this existed (#773). A fresh install
     * that silently dropped it would re-create the strand.
     */
    maxHoldHours?: number | null;
    /**
     * Capital the bot may use, in account currency (#894) — the base for the rating's
     * risk condition. null/absent = NOT SET.
     *
     * ⚠️ ABSENT MEANS "NO OPINION", so a bot that omits it keeps whatever an operator set.
     * That is deliberate: a rating base is an operator decision, and a seeder that stamped a
     * default over it would rate every bot against a number nobody chose. Only bots that
     * declare a value here are converged.
     */
    allocationAmount?: number | null;
  }>, opts?: {
    /**
     * Report drift but write NOTHING (#833 acceptance criterion 3).
     *
     * This is the read-only half of convergence, and it exists so a scheduled or CI check can ask
     * "does the database still match `strategy-seed-data.ts`?" without mutating it. Without this,
     * the only way to detect drift was to repair it — which is why drift went unnoticed.
     */
    dryRun?: boolean;
  }): Promise<{
    /** Dry-run only: what WOULD have been written. Always empty on a real run — see `counts`. */
    dryRun: boolean;
    created: number;
    /** Rows whose declared config differed and were converged back to the seed. */
    updated: number;
    /** Rows already matching the seed — no write was needed. */
    unchanged: number;
    /** Create attempts that threw. Never silently folded into `unchanged`. */
    failed: number;
    scoringCreated: number;
    /** Bots that existed with NO `strategy_protocol` row and were given one. */
    subscriptionsRepaired: number;
    /** Bots whose subscription role was wrong (e.g. a short bot routed as 'long'). */
    rolesCorrected: number;
    /** Which fields moved, per bot — so a re-seed says WHAT it changed, not just how many. */
    changes: Array<{ bot: string; fields: string[] }>;
  }> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Seed skipped — database unavailable. This is NOT a successful seed.');
      return {
        dryRun: !!opts?.dryRun,
        created: 0, updated: 0, unchanged: 0, failed: strategies.length,
        scoringCreated: 0, subscriptionsRepaired: 0, rolesCorrected: 0, changes: [],
      };
    }

    const dryRun = !!opts?.dryRun;

    let created = 0, updated = 0, unchanged = 0, failed = 0, scoringCreated = 0;
    let subscriptionsRepaired = 0, rolesCorrected = 0;
    const changes: Array<{ bot: string; fields: string[] }> = [];

    for (const s of strategies) {
      const existing = await (this.prisma as any).tradingStrategy.findFirst({
        where: { name: s.name, symbol: s.symbol },
      });

      // ── ALREADY EXISTS → CONVERGE TO THE SEED ───────────────────────────────────────────
      if (existing) {
        // ⚠️ REQUIRED FIELDS — always declared, so always converged.
        const desired: Record<string, unknown> = {
          protocolId: s.protocolId,
          brokerId: s.brokerId,
          mode: s.mode,
          timeframe: s.timeframe,
          baseSize: s.baseSize,
          slPct: s.slPct,
          tpPct: s.tpPct,
          // #1018 — CONVERGED, not insert-only. An `update` that omits this cannot repair a row
          // whose magic was never assigned, so a re-seed would leave the fleet half-attributable.
          ...(s.magic != null ? { magic: s.magic } : {}),
          minComposite: s.minComposite,
        };

        // ⚠️ OPTIONAL FIELDS — ABSENT MEANS "NO OPINION", NEVER "SET TO NULL".
        //
        // 🛑 THIS IS NOT STYLE, IT IS A MEASURED REGRESSION. The first version of this fix wrote
        // `maxHoldHours: (s as any).maxHoldHours ?? null` for EVERY bot. The seeder declares
        // `maxHoldHours` for the FX session bots but OMITS it for the gold bots — so the first
        // live re-seed wrote **null** over four gold time-stops (72h, 120h, 4h, 24h) and Tokyo
        // USDJPY's (12h), silently removing the slot-releasing control that #773 exists to
        // provide. It also flipped five bots from `auto` to `semi-auto`, which stops them
        // dispatching at all (`automation-loop.service.ts` Gate 2: "auto bots only").
        //
        // Both were caught by re-reading the rows, not by a test. The tests below now cover the
        // absent-field case, because "the seed did not mention it" and "the seed says null" are
        // different statements and only `'x' in s` can tell them apart.
        // Both ABSENT and explicitly `undefined` mean "no opinion" — only a real value (including
        // an explicit `null`) is a declaration worth writing. `'x' in s` is NOT equivalent here:
        // it is true for a key that exists holding `undefined`, which is exactly the shape a
        // spread produces (`{ ...entry, maxHoldHours: undefined }`), so it would clear the field.
        if (s.sessionWindow !== undefined) {
          // `s.sessionWindow && ...` — an entry may legitimately declare `sessionWindow: null`
          // (ungated), and `null.length` throws. That mistake was caught by these tests.
          desired.sessionWindow =
            s.sessionWindow && s.sessionWindow.length ? JSON.stringify(s.sessionWindow) : null;
        }
        if ((s as any).requireDirection !== undefined) {
          desired.requireDirection = (s as any).requireDirection;
        }
        if ((s as any).maxHoldHours !== undefined) {
          desired.maxHoldHours = (s as any).maxHoldHours;
        }
        // #928 — optional on the same contract. A seeder that does not mention the boundary
        // leaves whatever is on the row alone; only a real value (including an explicit null) is a
        // declaration worth writing.
        if ((s as any).exitBeforeUtc !== undefined) {
          desired.exitBeforeUtc = (s as any).exitBeforeUtc;
        }
        // #894 — the rating's risk base. Optional like the rest: a bot that does not declare it
        // keeps its current value, and there is no default to fall back to on purpose.
        if ((s as any).allocationAmount !== undefined) {
          desired.allocationAmount = (s as any).allocationAmount;
        }
        if ((s as any).active !== undefined) {
          desired.active = (s as any).active;
        }

        const differing = Object.keys(desired).filter(
          (k) => !seedFieldMatches((existing as any)[k], desired[k]),
        );

        if (differing.length) {
          if (!dryRun) {
            await (this.prisma as any).tradingStrategy.update({
              where: { id: existing.id },
              data: desired,
            });
          }
          updated++;
          changes.push({ bot: `${s.name} (${s.symbol})`, fields: differing });
        } else {
          unchanged++;
        }

        // Queue routing requires a protocol SUBSCRIPTION — see the method header.
        const wantRole =
          resolveEffectiveRole(null, (s as any).requireDirection) ??
          (/-short|short-/i.test(s.protocolId) ? 'short' : 'long');
        const sub = await (this.prisma as any).strategyProtocol.findFirst({
          where: { strategyId: existing.id, protocolId: s.protocolId },
        });
        if (!sub) {
          if (dryRun) {
            subscriptionsRepaired++;
          } else {
            try {
              await (this.prisma as any).strategyProtocol.create({
                data: {
                  strategyId: existing.id,
                  protocolId: s.protocolId,
                  role: wantRole,
                  sortOrder: 0,
                },
              });
              subscriptionsRepaired++;
            } catch (subErr) {
              this.logger.warn(
                `Could not subscribe ${s.name} to ${s.protocolId}: ${(subErr as Error).message}`,
              );
            }
          }
        } else if (sub.role !== wantRole) {
          if (dryRun) {
            rolesCorrected++;
          } else {
            try {
              await (this.prisma as any).strategyProtocol.update({
                where: { id: sub.id },
                data: { role: wantRole },
              });
              rolesCorrected++;
            } catch (roleErr) {
              this.logger.warn(
                `Could not correct role for ${s.name}: ${(roleErr as Error).message}`,
              );
            }
          }
        }
        continue;
      }

      // Create or find scoring strategy
      let scoringId: string | null = null;
      try {
        const existingScoring = await (this.prisma as any).scoringStrategy.findFirst({
          where: { protocolId: s.protocolId, watchlistName: 'default' },
        });
        if (existingScoring) {
          scoringId = existingScoring.id;
        } else {
          const createdScoring = await (this.prisma as any).scoringStrategy.create({
            data: {
              name: `${s.name} Scoring`,
              protocolId: s.protocolId,
              watchlistName: 'default',
              enabled: true,
              tradeThreshold: s.minComposite,
              mode: 'score',
            },
          });
          scoringId = createdScoring.id;
          scoringCreated++;
        }
      } catch (err) {
        this.logger.warn(`Could not create scoring strategy for ${s.name}: ${(err as Error).message}`);
      }

      // Create trading strategy
      try {
        const createdBot = await (this.prisma as any).tradingStrategy.create({
          data: {
            name: s.name,
            symbol: s.symbol,
            protocolId: s.protocolId,
            brokerId: s.brokerId,
            mode: s.mode,
            timeframe: s.timeframe,
            baseSize: s.baseSize,
            slPct: s.slPct,
            tpPct: s.tpPct,
            minComposite: s.minComposite,
            scoringStrategyId: scoringId,
            // Session gate — JSON array of tags, or null when ungated.
            sessionWindow: s.sessionWindow?.length ? JSON.stringify(s.sessionWindow) : null,
            // Direction constraint. A SHORT_ONLY protocol must not be allowed to
            // open longs; null = unconstrained (legacy behaviour).
            requireDirection: (s as any).requireDirection ?? null,
            // Position time-stop (#773) and start state — both optional in the seed,
            // defaulted here so every existing entry keeps its behaviour.
            maxHoldHours: (s as any).maxHoldHours ?? null,
            // #928 — the exit-side boundary, on the same terms as the hold limit above.
            exitBeforeUtc: (s as any).exitBeforeUtc ?? null,
            active: (s as any).active ?? true,
            // #894 — NULL, never a substituted default: "no allocation set" is a state the
            // rating reports by name (`allocation_not_set`) rather than a number to invent.
            allocationAmount: (s as any).allocationAmount ?? null,
          },
        });

        // Queue routing requires a protocol SUBSCRIPTION (strategy_protocol).
        // SignalQueueService routes by subscription, NOT by trading_strategy —
        // a bot with no subscription can never receive a queued signal, so it
        // stays invisible in the bot queue and can never trade via that path.
        // NOTE: `protocolId` here is the protocol SLUG (matching the routing
        // records at runtime), while trading_strategy.protocolId may hold a UUID.
        //
        // ⚠️ `role` is DERIVED, not hardcoded. It was hardcoded 'long', which is wrong for the
        // SHORT_ONLY protocol (vix-short-v1) — a short bot seeded as role 'long' would be routed as
        // if it were going long.
        //
        // Precedence: the bot's DECLARED `requireDirection` wins, because that is the field the
        // create form exposes and the field a person sets. The protocol-name heuristic remains only
        // as a fallback for seeds that declare nothing — it is a name guess, and it cannot be
        // removed until every seeded bot declares its direction, since removing it silently would
        // flip a short bot back to 'long'.
        try {
          const declared = resolveEffectiveRole(null, (s as any).requireDirection);
          const shortFromName = /-short|short-/i.test(s.protocolId);
          await (this.prisma as any).strategyProtocol.create({
            data: {
              strategyId: createdBot.id,
              protocolId: s.protocolId,
              role: declared ?? (shortFromName ? 'short' : 'long'),
              sortOrder: 0,
            },
          });
        } catch (subErr) {
          this.logger.warn(`Could not subscribe ${s.name} to ${s.protocolId}: ${(subErr as Error).message}`);
        }

        created++;
      } catch (err) {
        this.logger.warn(`Could not create trading strategy ${s.name}: ${(err as Error).message}`);
        failed++;
      }
    }

    this.logger.log(
      `Seed ${dryRun ? 'DRY RUN ' : ''}complete: ${created} created, ${updated} updated, ` +
        `${unchanged} unchanged, ${failed} failed, ${scoringCreated} scoring auto-created`,
    );
    if (subscriptionsRepaired || rolesCorrected) {
      this.logger.warn(
        `Seed repaired queue routing: ${subscriptionsRepaired} subscription(s) created, ` +
          `${rolesCorrected} role(s) corrected — without these the affected bots could never trade`,
      );
    }
    // Say WHAT moved, not just how many rows — a bare count is unauditable.
    for (const c of changes) {
      this.logger.log(`  converged ${c.bot}: ${c.fields.join(', ')}`);
    }
    return {
      dryRun,
      created, updated, unchanged, failed, scoringCreated,
      subscriptionsRepaired, rolesCorrected, changes,
    };
  }
}

/**
 * Compare a stored value against a seed-declared value for convergence (#833).
 *
 * ⚠️ WHY NOT `===`. Prisma returns numbers for `Float`/`Int`, but a seed literal can arrive as a
 * numeric string, and `0.01 !== '0.01'` would report a change on EVERY run — making the seeder
 * rewrite all 26 rows forever and drowning the real diffs. Floats also need a tolerance, since
 * `baseSize` round-trips through MySQL's DOUBLE. Null and undefined are treated as the same
 * "no value" so an absent optional field does not flap between runs.
 */
function seedFieldMatches(stored: unknown, desired: unknown): boolean {
  if (stored === desired) return true;
  if (stored == null && desired == null) return true;
  if (typeof stored === 'boolean' || typeof desired === 'boolean') {
    return Boolean(stored) === Boolean(desired);
  }
  if (typeof stored === 'number' || typeof desired === 'number') {
    if (stored == null || desired == null) return false;
    const a = Number(stored);
    const b = Number(desired);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) < 1e-9;
  }
  return String(stored) === String(desired);
}

function rarityBandRank(band: string): number {
  const order = ['standard', 'strong', 'exceptional', 'cyclical', 'black-swan'];
  return order.indexOf(band);
}
