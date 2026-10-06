import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolGatingService, GatedScore, DirectiveBreakout } from '../scoring/protocol-gating.service';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';
// #R13 — the SAME predicate the dispatch path uses for feasibility, so "closed" means one thing
// in this system rather than two.
import { computeMarketStatus } from '../directives/market-status';
import { ScoreHistoryService } from '../scoring/score-history.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { SignalQueueService, RoutableSignal } from './signal-queue.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { ManualTradeDefaultsService } from './manual-trade-defaults.service';
import { ExecutionFeasibilityService, FeasibilityBlocker } from '../trading/execution-feasibility.service';
import { OutcomeTrackerService } from '../scoring/outcome-tracker.service';
import { selectBaseTimeframe, everyCadenceStale } from '../../common/utils/timeframe';
// ⚠️ SINGLE AUTHORITY for signal-class → direction/side. Do NOT reintroduce a prefix test here:
// `'STRONG_SELL'.startsWith('SELL')` is FALSE, which routed the strongest bearish signal as a
// LONG/BUY. See the file header in `signal-direction.ts` for the measured evidence.
import { signalToDirection, signalToSide, isBuySignal, isSellSignal } from '../../common/utils/signal-direction';
// #926 follow-up — the ONE group-shaping implementation, shared with the persisted-breakdown path.
import { shapeEnvelopeGroups } from '../../common/utils/envelope-groups';
import {
  resolveStyleThreshold,
  SIGNALS_GATE_DEFAULT,
  StyleGateResolution,
} from '../../common/utils/style-thresholds';

/** Strategy ID used when persisting Signals Workbench scores. */
const SIGNALS_WORKBENCH_STRATEGY_ID = 'signals-workbench';

// ── #718 per-protocol entry gate ────────────────────────────────────────
// The pre-trade gate is not a hardcoded 65 for every protocol. Order:
//   1. per-protocol override in global_setting: `signals.gate.<protocolId>`
//   2. the protocol's trading style
//   3. SIGNALS_GATE_DEFAULT (65 — the historical Signals gate, deliberately
//      NOT the automation loop's 60, so neither path changes)
// The style→bar table and its matcher now live in common/utils/style-thresholds.ts.
// Do NOT re-declare the numbers here — the previous duplicate drifted from the
// loop's copy and only one of the two would have received the next fix.

// NOTE: selectBaseTimeframe() now lives in common/utils/timeframe.ts (#751) so the
// Arena and the scoring path resolve cadence the same way this service does. It was
// module-private here, which is why those two callers hand-rolled their own bar
// queries and lost the timeframe filter. Import it — do not re-add a local copy.

/**
 * SignalEnvelopeService
 * =====================
 * Bridges the scoring pipeline (ProtocolGatingService) into rich signal envelopes
 * for the Signals Workbench UI.
 *
 * Produces per-symbol envelopes with:
 *  - Signal ladder (ranked by composite score)
 *  - Directive drilldown (which directives fired, why, and their individual scores)
 *  - Conflict detection (directives disagreeing on direction)
 *  - Confidence rails (risk gate severity, rarity, multi-timeframe agreement)
 *  - Pre-trade readiness flags
 */

export interface SignalEnvelope {
  symbol: string;
  /** Risk-adjusted raw signal. Never compare this value with a percentage threshold. */
  composite: number;
  maxPossible: number;           // max achievable score for this envelope
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;            // 0-100 confidence score
  rarity: string | null;         // e.g. "Exceptional", "Strong"
  rarityColor: string | null;
  riskGate: {
    active: boolean;
    multiplier: number;
    triggered: boolean;
    reason: string | null;
    chain: Array<{ rule: string; multiplier: number; severity: number }>;
    warnings: string[];
  };
  groups: Array<{
    groupId: string;
    groupName: string;
    score: number;               // 0-100 normalized group score
    weight: number;
    isRisk: boolean;
    topDirectives: Array<{
      id: string;
      name: string;
      score: number;
      maxScore: number;
      normalized: number;        // 0-100
      signalClass: string;       // bullish, bearish, neutral
      reason: string;
    }>;
  }>;
  conflicts: Array<{
    type: 'bull_bear' | 'score_divergence' | 'timeframe_mismatch';
    severity: 'low' | 'medium' | 'high';
    description: string;
    directives: string[];
  }>;
  preTradeReady: boolean;
  preTradeBlockers: string[];
  /**
   * #974 — a MACHINE code per blocker, positionally parallel to `preTradeBlockers`.
   *
   * WHY a parallel array and not `{code,text}[]`: `preTradeBlockers` is already read by existing
   * consumers, and changing its element type would ripple through all of them to serve a NEW
   * diagnostic.
   *
   * WHY the code is assigned at the branch that KNOWS the cause rather than derived later from the
   * text: a classifier that reads "Signal below 12% (6.5%)" and concludes BELOW_GATE is a second
   * source of truth for one fact, and it breaks the moment someone rewords the message.
   *
   * Optional so an envelope built by a path that did not set it stays valid; absent reads as
   * "uncoded", which is honest — it is not the same as "no blocker".
   */
  preTradeBlockerCodes?: string[];
  scoredAt: string;
  // ── #684 Signals v1 — best-of metadata ──
  protocolId: string | null;
  protocolName: string | null;
  /** Executing bot (TradingStrategy) name — distinct from the protocol (signal thesis). */
  botName?: string | null;
  directionMode: 'LONG_ONLY' | 'SHORT_ONLY';
  scoreId: string | null;          // persisted Score row id — required for /:id/action + /:id/trade
  signalPct: number | null;        // pre-gate directional % (classification basis)
  opportunityPct: number | null;   // additive screening %
  combinedStrength: number;        // 0.5×signalPct + 0.5×opportunityPct — the best-of rank
  marketStatus: { open: boolean; asOf: string | null; reason?: string } | null;
  holdsCfd: boolean;               // MT5 position exists for this symbol
  /** #723 — execution blockers assessed at GENERATION time (same library that
   *  re-checks at execution). Each carries a change-hint. */
  executionBlockers?: FeasibilityBlocker[];
}

export interface SignalLadder {
  generatedAt: string;
  protocolId: string | null;
  protocolName: string | null;
  totalSymbols: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  envelopes: SignalEnvelope[];
  topConflicts: Array<{
    symbol: string;
    conflictCount: number;
    severity: 'low' | 'medium' | 'high';
  }>;
  /**
   * #R13 — symbols this ladder did NOT score, and why. Present so a skip is a FACT a caller can
   * render: a symbol that quietly disappears from a ladder is indistinguishable from a broken
   * feed, and "not scored because the market is closed" must never read the same as "scored and
   * held" (the visible-as-a-skip rule #956 asks for).
   */
  skipped?: Array<{ symbol: string; reason: string }>;
}

/** Multi-protocol comparison result — one ladder per protocol + comparison matrix */
export interface MultiProtocolLadder {
  generatedAt: string;
  symbols: string[];
  protocols: Array<{
    id: string;
    name: string | null;
    ladder: SignalLadder;
  }>;
  /** Comparison matrix: rows = symbols, columns = protocols */
  comparison: Array<{
    symbol: string;
    scores: Record<string, { composite: number; signal: string; symbolId?: string }>;
  }>;
}

/**
 * Best-of response (#684) — every active protocol scored, one card per
 * symbol per direction (best protocol wins), action-only, ranked by
 * combined strength. No symbol or protocol selection required.
 */
export interface SignalBestResponse {
  generatedAt: string;
  activeProtocols: number;
  totalSymbols: number;
  buyCount: number;
  sellCount: number;
  envelopes: SignalEnvelope[];
}

/** Per-protocol scoring status produced by buildBestLadder (#714). */
export interface ProtocolScoreStatus {
  state: string;
  reason?: string;
  symbolsResolved?: number;
  symbolsScored?: number;
}

@Injectable()
export class SignalEnvelopeService {
  private readonly logger = new Logger(SignalEnvelopeService.name);

  /** Per-protocol gate overrides, cached briefly (60s TTL). */
  private gateOverrides: { loadedAt: number; map: Map<string, number> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly protocolDb: ProtocolDbService,
    private readonly marketData: MarketDataService,
    private readonly scoreHistory: ScoreHistoryService,
    private readonly adapterFactory: AdapterFactory,
    private readonly signalQueue: SignalQueueService,
    private readonly signalOutcomes: SignalOutcomeService,
    private readonly feasibility: ExecutionFeasibilityService,
    private readonly outcomeTracker: OutcomeTrackerService,
    /**
     * #914 — read at generation so `size-below-minimum` can fire on the CARD. Optional only so
     * unit tests can construct the service without it; production wiring always provides it.
     */
    private readonly tradeDefaults?: ManualTradeDefaultsService,
  ) {}

  /**
   * Build a full signal ladder for a set of symbols.
   */
  /**
   * #R13 — the reason the LIVE ladder should not score this symbol, or `null` to go ahead.
   *
   * Owner, 2026-09-23: *"if the market is closed there is not meant to be new data for those
   * symbols so why score?"* — ruled a **development decision**, not a policy or A/B change, so
   * there is deliberately no copied configuration behind it.
   *
   * Measured before the gate (24h): **840 of 5,756** `score` rows were produced while
   * `marketStatus.open === false`.
   *
   * ⚠️ FAILS OPEN. If the status cannot be computed this returns `null` and scoring proceeds: a
   * status check must never silently stop the pipeline's work, and "we could not tell" is not "the
   * market is closed" — the exact distinction #732 was fixed for.
   */
  private async closedMarketSkipReason(ticker: string): Promise<string | null> {
    try {
      const symbolRow = await this.prisma.symbol.findFirst({ where: { ticker } });
      if (!symbolRow) return null; // unknown symbol — the envelope path reports that properly
      const bars = await this.marketData.getBars(symbolRow.id, '5m', 20);
      if (!bars || bars.length === 0) return null; // no bars is a FEED problem, not a closure
      const status = computeMarketStatus(bars);
      if (status.open) return null;
      return `market closed (${status.reason ?? 'no reason reported'})`;
    } catch {
      return null; // fail open, deliberately
    }
  }

  async buildLadder(
    symbols: string[],
    protocolId?: string,
  ): Promise<SignalLadder> {
    // A protocol is required — the unscoped 'default' pipeline was removed (2026-08-22)
    if (!protocolId) {
      return {
        generatedAt: new Date().toISOString(),
        protocolId: null,
        protocolName: null,
        totalSymbols: 0,
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        envelopes: [],
        topConflicts: [],
        message: 'A protocol is required for ladder scoring — unscoped default scoring was removed.',
      } as SignalLadder & { message: string };
    }

    const envelopes: SignalEnvelope[] = [];
    // #R13 — symbols NOT scored because their market is closed.
    const skipped: Array<{ symbol: string; reason: string }> = [];

    for (const ticker of symbols) {
      try {
        // ⚠️ #R13 — DO NOT SPEND SCORING ON A CLOSED MARKET.
        //
        // The owner's own reasoning, and it is the whole argument: no new data can arrive for a
        // symbol whose market is shut, so a score taken then can never become a trade. The only
        // value it has is planning (#640 — which uses the ON-DEMAND path, untouched here) and
        // diagnostics (#732 — `computeMarketStatus` itself is untouched, so "closed" and "stale
        // feed" remain distinguishable).
        const closed = await this.closedMarketSkipReason(ticker);
        if (closed) {
          skipped.push({ symbol: ticker, reason: closed });
          continue;
        }
        const envelope = await this.buildEnvelope(ticker, protocolId);
        envelopes.push(envelope);
      } catch (err) {
        this.logger.warn(`Skipping ${ticker}: ${(err as Error).message}`);
        envelopes.push(this.emptyEnvelope(ticker));
      }
    }

    if (skipped.length > 0) {
      this.logger.log(
        `#R13 — not scored, market closed: ${skipped.length}/${symbols.length} symbol(s) ` +
          `(${skipped.slice(0, 5).map((s) => s.symbol).join(', ')}${skipped.length > 5 ? ' +' + (skipped.length - 5) : ''})`,
      );
    }

    // Sort by composite descending
    envelopes.sort((a, b) => b.composite - a.composite);

    const buyCount = envelopes.filter(e => e.signal === 'BUY').length;
    const sellCount = envelopes.filter(e => e.signal === 'SELL').length;
    const holdCount = envelopes.filter(e => e.signal === 'HOLD').length;

    // Collect top conflicts
    const topConflicts = envelopes
      .filter(e => e.conflicts.length > 0)
      .map(e => ({
        symbol: e.symbol,
        conflictCount: e.conflicts.length,
        severity: e.conflicts.some(c => c.severity === 'high') ? 'high' as const
          : e.conflicts.some(c => c.severity === 'medium') ? 'medium' as const
          : 'low' as const,
      }))
      .sort((a, b) => b.conflictCount - a.conflictCount)
      .slice(0, 10);

    const protocolName = protocolId ? this.getProtocolName(protocolId) : null;

    // ── Persist scores to DB so they appear in scoring-runs / scoring-activity-logs ──
    const strategyId = protocolId || SIGNALS_WORKBENCH_STRATEGY_ID;
    try {
      const ids = await this.persistScores(envelopes, strategyId);
      for (const env of envelopes) {
        if (ids[env.symbol]) env.scoreId = ids[env.symbol];
      }
    } catch (err) {
      this.logger.warn(`Failed to persist signal scores: ${(err as Error).message}`);
    }

    return {
      generatedAt: new Date().toISOString(),
      protocolId: protocolId ?? null,
      protocolName,
      totalSymbols: envelopes.length,
      buyCount,
      sellCount,
      holdCount,
      envelopes,
      topConflicts,
      skipped,
    };
  }

  /**
   * Build a multi-protocol comparison ladder.
   * Runs buildLadder for each protocol and produces a comparison matrix
   * where rows = symbols and columns = protocols.
   *
   * @param symbols - Array of ticker strings
   * @param protocolIds - Array of protocol slugs to compare
   * @param resolveSymbolIds - If true, look up DB symbol IDs for each ticker
   */
  async buildComparisonLadder(
    symbols: string[],
    protocolIds: string[],
    resolveSymbolIds = false,
  ): Promise<MultiProtocolLadder> {
    const protocols: MultiProtocolLadder['protocols'] = [];

    for (const protocolId of protocolIds) {
      try {
        const ladder = await this.buildLadder(symbols, protocolId);
        const name = ladder.protocolName || protocolId;
        protocols.push({ id: protocolId, name, ladder });
      } catch (err) {
        this.logger.warn(`Skipping protocol ${protocolId}: ${(err as Error).message}`);
      }
    }

    // Build comparison matrix
    const symbolIdMap = new Map<string, string>();
    if (resolveSymbolIds) {
      const dbSyms = await this.prisma.symbol.findMany({
        where: { ticker: { in: symbols.map(s => s.toUpperCase()) } },
        select: { ticker: true, id: true },
      });
      for (const s of dbSyms) {
        symbolIdMap.set(s.ticker, s.id);
      }
    }

    const comparison: MultiProtocolLadder['comparison'] = symbols.map(ticker => {
      const clean = ticker.toUpperCase();
      const scores: Record<string, { composite: number; signal: string; symbolId?: string }> = {};
      for (const p of protocols) {
        const env = p.ladder.envelopes.find(e => e.symbol === clean);
        scores[p.id] = {
          composite: env?.composite ?? 0,
          signal: env?.signal ?? 'HOLD',
          ...(symbolIdMap.has(clean) ? { symbolId: symbolIdMap.get(clean) } : {}),
        };
      }
      return { symbol: clean, scores };
    });

    return {
      generatedAt: new Date().toISOString(),
      symbols: symbols.map(s => s.toUpperCase()),
      protocols,
      comparison,
    };
  }

  /**
   * Build a single signal envelope for one symbol.
   */
  async buildEnvelope(
    ticker: string,
    protocolId?: string,
  ): Promise<SignalEnvelope> {
    const cleanTicker = ticker.toUpperCase();

    // Look up symbol
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: cleanTicker },
    });

    const protocol = protocolId
      ? (this.protocolDb.getCached(protocolId) ?? await this.protocolDb.findBySlug(protocolId))
      : undefined;
    const requiredBars = protocolId ? this.protocolDb.getRequiredBars(protocolId) : { '1d': 200 };
    const baseTimeframe = selectBaseTimeframe(protocol?.recommendedTimeframe);
    // ⚠️ #1013 — the BASE cadence must use the ONE sizing rule. `requiredBars[baseTimeframe]
    // || 200` was the same fall-through as the other sites: it returned the base-cadence
    // declaration (20 for `btc-speed-v1`) and never consulted the larger generic `'1d'`
    // requirement (72). MEASURED: 4 of that protocol's 13 directives returned 0 on 246 of 247
    // ticks (99.6%) with the reason `need 72 bars, have 20`, while 3,504 fresh 5m bars sat
    // unused in `marketbar`. The `|| 200` never fired, because 20 is TRUTHY.
    const baseBars = protocolId
      ? this.protocolDb.getBaseBarCount(protocolId, baseTimeframe)
      : requiredBars['1d'] || 200;
    const [marketBars, dayBars, hourBars, min15Bars] = sym
      ? await Promise.all([
          this.marketData.getBars(sym.id, baseTimeframe, baseBars),
          this.marketData.getBars(sym.id, '1d', requiredBars['1d'] || 200),
          this.marketData.getBars(sym.id, '1h', requiredBars['1h'] || 200),
          this.marketData.getBars(sym.id, '15m', requiredBars['15m'] || 200),
        ])
      : [[], [], [], []];

    if (!marketBars || marketBars.length === 0) {
      return this.emptyEnvelope(cleanTicker);
    }

    // ⚠️ A STALE SET IS NOT AN EMPTY SET, BUT A SYMBOL IS ONLY "DEAD" WHEN **EVERY** CADENCE IS
    // STALE — NOT WHEN ITS BASE CADENCE IS (#827).
    //
    // This was the whole defect: the guard above rejects EMPTY and nothing else, so a symbol whose
    // bars stopped on 17 July sailed through and was SCORED with no current market state to judge.
    // Ten US equities (TSLA, COIN, PLTR, SOFI, RKLB, RIOT, MARA, ASTS, HOOD…) all shared one exact
    // stale timestamp (`21:00:00`) from a single import that was never refreshed, and were still
    // producing scores EIGHT WEEKS later. The damage was the DATE as much as the score: see
    // `predictedAt` below.
    //
    // ⚠️ THE OBVIOUS IMPLEMENTATION IS WRONG, AND WAS MEASURED TO BE WRONG BEFORE SHIPPING.
    // Checking only `baseTimeframe` skipped **11 symbols, ALL of them ALIVE** — SPY, QQQ, US500,
    // USTEC, XAUUSD, XAGUSD, UK100, GER40, FRA40, CHINA50, VIX. Measured cadence ages at the time:
    //
    //     SPY    1m=12h  <- rejected on this   5m=0.1h  15m=12h  1h=4.7h  1d=35h
    //     XAUUSD 1m=8.6h <- rejected on this   5m=0.0h  15m=0.0h 1h=0.7h  1d=11h
    //
    // A `1m` feed goes quiet whenever the market is closed or the session is thin — the `1m`
    // tolerance is 1h, while a US equity's overnight gap is ~17h. So a base-cadence-only check
    // silently removes the core instruments from the ladder outside cash hours, which is a far
    // worse failure than the one it fixes. The issue's own wording is "a symbol with NO bar within
    // the last N minutes" — i.e. no fresh cadence ANYWHERE.
    //
    // The four arrays below are exactly what the envelope loads, so this is the symbol's whole
    // picture. A genuinely dead symbol is stale on all of them (HOOD: 1h ended 31 July, `1d` too),
    // so it is still caught.
    //
    // ⚠️ RESIDUAL, DELIBERATELY NOT FIXED HERE: a symbol that is alive overall but stale on its
    // BASE cadence (SPY above) still scores from that stale array. That is the last known state and
    // is defensible while the market is shut, but the honest fix is to SCORE ON THE FRESHEST
    // AVAILABLE cadence rather than to skip, which would change what every protocol evaluates. That
    // is a design decision, not a bug fix, so it is called out rather than smuggled in.
    const cadenceSets: Array<{ tf: string; bars: any[] }> = [
      { tf: baseTimeframe, bars: marketBars },
      { tf: '1d', bars: dayBars },
      { tf: '1h', bars: hourBars },
      { tf: '15m', bars: min15Bars },
    ].filter((s) => Array.isArray(s.bars) && s.bars.length > 0);

    const dead = everyCadenceStale(
      cadenceSets.map((s) => ({ timeframe: s.tf, newest: s.bars[s.bars.length - 1]?.timestamp })),
    );

    if (dead) {
      const newestOfTf = (tf: string) => {
        const set = cadenceSets.find((s) => s.tf === tf);
        return set ? new Date(set.bars[set.bars.length - 1].timestamp).toISOString() : 'none';
      };
      this.logger.warn(
        `Skipped scoring ${cleanTicker}: EVERY cadence is stale (${cadenceSets
          .map((s) => `${s.tf}=${newestOfTf(s.tf)}`)
          .join(', ')}). The symbol has no current market state, so scoring it would produce a ` +
        `plausible number for a moment that has passed. Not scored (#827).`,
      );
      const skipped = this.emptyEnvelope(cleanTicker);
      skipped.preTradeBlockers = [
        `No current market data — every cadence is stale (base ${baseTimeframe} newest ` +
        `${newestOfTf(baseTimeframe)}). Not scored (#827).`,
      ];
      skipped.preTradeBlockerCodes = ['STALE_CADENCE'];
      return skipped;
    }

    // Score via ProtocolGatingService
    //
    // ⚠️ `baseTimeframe` is passed THROUGH (2026-09-10). It was computed above
    // only to select the bars, then dropped — so every directive that judges
    // freshness had to infer the cadence from the array it happened to receive.
    // When that array is mixed the inference is meaningless and FRESH data reads
    // as stale: `liquidity-check` returns `score: 0`, the risk engine turns that
    // into a hard gate, and the composite collapses to 0 against a 65 threshold.
    // Live, that blocked every tick of `spy-day-v1`, `qqq-day-v1` and
    // `spy-speed-v1`, and 12 of 22 ticks of `xau-speed-v1`. The cadence is
    // already known here — passing it is what stops the false close.
    const gated = await this.protocolGating.scoreWithGating(
      cleanTicker,
      marketBars,
      protocolId,
      { dayBars, hourBars, min15Bars },
      'group-weighted',
      baseTimeframe,
    );

    // Feed learning from the canonical live path. The retired rankAll path is
    // not an execution decision source and must not be the sole producer.
    const priceAtPredict = Number(marketBars[marketBars.length - 1]?.close ?? 0);
    if (priceAtPredict > 0) {
      // ⚠️ `predictedAt` IS THE DECISION TIME, NOT THE BAR'S TIMESTAMP (#827).
      //
      // This read `marketBars[marketBars.length - 1].timestamp` — the evaluated bar's OPEN time.
      // That is fragile even for a healthy symbol (a delayed import mis-dates the prediction),
      // but for a stale one it is destructive: the row claimed a prediction made months ago, and
      // because the maturation sweep is `orderBy: predictedAt ASC`, it sorted ahead of every real
      // row. All four horizons are measured FORWARD from this value (`predicted + 15m/1h/4h/24h`),
      // so a stale base also made them target prices inside a dead window that may never fill.
      //
      // A prediction is a decision made NOW about the future. `priceAtPredict` is still the last
      // bar's close — that is the price the decision was based on — but the CLOCK is now.
      const decidedAt = new Date();
      this.outcomeTracker.recordOutcomes(
        Object.values(gated.breakouts).flat()
          .filter(item => item.score > 0 && item.signalClass !== 'neutral')
          .map(item => ({
            directiveId: item.directiveId,
            symbol: cleanTicker,
            // ⚠️ #821 — `strategyId` was OMITTED here, so `directiveoutcome.strategyId`
            // was NULL in 16,673 of 16,673 rows (100%) and NO per-protocol statistic was
            // computable. The table collected correctly and was simply unattributable,
            // which is why it reported nothing while its row count grew healthily.
            //
            // `protocolId` is the PROTOCOL SLUG, matching `score.strategyId` — the two
            // tables must use the same key or they cannot be joined. Do not switch this
            // to the protocol UUID; that was the shape of the original mistake.
            strategyId: protocolId,
            timeframe: baseTimeframe,
            score: item.score,
            signalClass: item.signalClass,
            confidence: item.normalizedScore / 100,
            predictedAt: decidedAt,
            priceAtPredict,
          })),
      ).catch(err => this.logger.warn(`Outcome capture failed: ${(err as Error).message}`));
    }

    const envelope = await this.enrichEnvelope(cleanTicker, gated, protocolId);
    const directiveIds = new Set(protocol?.groups.flatMap(group => group.directiveIds) ?? []);
    const needsMtf = ['multi-timeframe-trend', 'mtf-confluence-conservative', 'mtf-confluence-weighted', 'micro-sr-levels']
      .some(id => directiveIds.has(id));
    if (needsMtf && (dayBars.length < 2 || hourBars.length < 10 || min15Bars.length < 10)) {
      envelope.preTradeReady = false;
      envelope.preTradeBlockers.push(
        `Incomplete timeframe bundle (1d=${dayBars.length}, 1h=${hourBars.length}, 15m=${min15Bars.length})`,
      );
      (envelope.preTradeBlockerCodes ??= []).push('INCOMPLETE_MTF');
    }
    return envelope;
  }

  /**
   * Enrich a GatedScore into a SignalEnvelope with confidence rails,
   * directive grouping, and conflict detection.
   */
  private async enrichEnvelope(
    symbol: string,
    gated: GatedScore,
    protocolId?: string,
  ): Promise<SignalEnvelope> {
    // Build group panels from breakouts
    const groups = this.buildGroups(gated);

    // Compute confidence from multiple signals
    const confidence = this.computeConfidence(gated);

    // Detect conflicts — gate groups excluded (#716): their subScore is
    // structurally 0 and must not manufacture divergences.
    const conflicts = this.detectConflicts(gated, protocolId);

    // Pre-trade readiness — #718 per-protocol gate: override key wins,
    // then the protocol's trading style, then the 65 default.
    //
    // #759: the style bar is then reconciled DOWN to the lowest participating
    // bot's `minComposite`, so a bot configured to act at 55 is not starved by a
    // gate of 65 it never mentioned. An explicit `signals.gate.<protocol>`
    // override is left alone — that is an instruction, not a default.
    const gate = await this.reconcileGateWithBots(
      await this.getGateThreshold(
        protocolId,
        protocolId ? this.protocolDb.getCached(protocolId)?.tradingStyle : undefined,
      ),
      protocolId,
    );
    const { preTradeReady, preTradeBlockers, preTradeBlockerCodes } = this.evaluatePreTrade(
      gated,
      conflicts,
      gate.threshold,
      gate.label,
    );

    // #684 — combined strength: best of Signal and Opportunity.
    // Signal % is the classification basis (pre-gate directional).
    const directionMode = gated.directionMode ?? 'LONG_ONLY';
    const signalPct = gated.signalPct;
    const opportunityPct = gated.opportunityPct ?? null;
    const combinedStrength =
      signalPct != null && opportunityPct != null
        ? Math.round((signalPct + opportunityPct) / 2)
        : (signalPct ?? opportunityPct ?? 0);

    const envelope: SignalEnvelope = {
      symbol,
      composite: gated.composite,
      maxPossible: gated.signalMax,
      signal: gated.signal,
      confidence,
      rarity: gated.rarity?.label ?? null,
      rarityColor: gated.rarity?.color ?? null,
      riskGate: {
        active: gated.gatingActive,
        multiplier: gated.riskMultiplier,
        triggered: gated.riskGate?.hardGateTriggered ?? false,
        reason: gated.riskGate?.hardGateReason ?? null,
        chain: (gated.riskGate?.multiplierChain ?? []).map(s => ({
          rule: s.name,
          multiplier: s.multiplier,
          severity: s.severity,
        })),
        warnings: gated.riskGate?.warnings ?? [],
      },
      groups,
      conflicts,
      preTradeReady,
      preTradeBlockers,
      preTradeBlockerCodes,
      scoredAt: new Date().toISOString(),
      // ── #684 Signals v1 metadata ──
      protocolId: protocolId ?? null,
      protocolName: protocolId ? this.getProtocolName(protocolId) : null,
      directionMode,
      scoreId: null, // assigned after persistence (persistScores returns ids)
      signalPct,
      opportunityPct,
      combinedStrength,
      marketStatus: gated.marketStatus ?? null,
      holdsCfd: false, // assigned by buildBestLadder from MT5 positions
    };

    // ⚠️ NO feasibility annotation here, deliberately (#935).
    // `buildEnvelope` is called BOTH by the single-symbol drilldown AND N times inside the ladder
    // batch (buildLadder / buildBestLadder). Annotating here would re-assess every envelope on the
    // batch endpoints a second time — the ladder already does it once for all N, with positions
    // and bot sizes resolved in a single pass. The verdict is added by the CALLER that owns the
    // boundary: `getDrilldown` (see the DECISION marker there).

    return envelope;
  }

  /**
   * annotateFeasibility() — the ONE place a single envelope is assessed for execution.
   *
   * STEP: the last thing that happens to an envelope before it is rendered or queued.
   * BEFORE: pre-trade gating (`evaluatePreTrade`) → `preTradeReady` / `preTradeBlockers`.
   * AFTER:  the card's verdict (`tradeReadiness`, frontend) and the queue's `isRouteable()`.
   *
   * Called by BOTH the drilldown (#935) and the ladder (#723), so the two paths cannot disagree
   * about whether a symbol can be ordered. That disagreement IS the #935 defect: the card said
   * ready while the order path refused, because only one of the two had been assessed.
   *
   * ⚠️ WARNING: `size` is the number that will ACTUALLY BE TRADED (#972). A bot-driven signal is
   * sized by its bot's `baseSize`; only a signal with no executing bot falls back to the manual
   * default, because only then does a human click the card. Sizing a bot's envelope from the
   * manual default once made a 0.1-floor symbol unroutable at 0.01 and silently disabled it — a
   * setting that had nothing to do with that symbol.
   *
   * ⚠️ FAILS CLOSED when the side cannot be derived: a signal class mapping to no direction must
   * block, because assessing feasibility for the WRONG direction still looks perfectly executable.
   *
   * @param preFetched  Supplied by the ladder, which resolves size/positions ONCE for N envelopes.
   *                    Omit it for a single drilldown and the helper resolves them itself.
   *                    `size: undefined` means "not supplied"; `size: null` means "unknown" and is
   *                    honoured as such rather than triggering a second lookup.
   */
  private async annotateFeasibility(
    env: SignalEnvelope,
    protocolId?: string | null,
    preFetched?: { positions?: any[]; size?: number | null },
  ): Promise<void> {
    try {
      const side = signalToSide(env.signal);
      if (!side) {
        env.executionBlockers = [
          {
            code: 'UNKNOWN_SIGNAL_CLASS',
            reason: `Signal class "${env.signal}" has no derivable side`,
          } as any,
        ];
        return;
      }

      // ⚠️ #972 — the BOT's size, not the manual default. The ladder passes its batched value in;
      // a drilldown resolves it here. Both land on the same rule.
      let size = preFetched?.size;
      if (size === undefined) {
        // ⚠️ Guarded on `protocolId` DELIBERATELY. An unscoped `findFirst` (no protocol filter)
        // would match ANY active bot holding this symbol and size the envelope from the WRONG
        // bot — while the ladder's own lookup, keyed `${protocolId}|${symbol}`, finds no match at
        // all and falls back to the manual default. The two paths must agree, so: no protocol,
        // no bot, manual default.
        let botBaseSize: number | null = null;
        if (protocolId) {
          try {
            const bot = await this.prisma.tradingStrategy.findFirst({
              where: { active: true, protocolId, symbol: env.symbol.toUpperCase() },
              select: { baseSize: true },
            });
            botBaseSize = bot?.baseSize ?? null;
          } catch {
            /* best-effort — an unknown size degrades to the manual default, never to a guess */
          }
        }
        const defaults = await this.tradeDefaults?.getDefaults().catch(() => null);
        size = botBaseSize ?? defaults?.size ?? null;
      }

      const res = await this.feasibility.assess({
        symbol: env.symbol,
        side,
        brokerId: 'mt5',
        protocolId: env.protocolId ?? protocolId ?? null,
        ...(preFetched?.positions ? { positions: preFetched.positions } : {}),
        marketStatus: env.marketStatus,
        size,
      });
      env.executionBlockers = res.blockers;
    } catch (err) {
      // ⚠️ Best-effort, and deliberately NOT a fabricated blocker. `executionBlockers` stays
      // `undefined`, which the frontend treats as "cannot judge" — never as ready. An unknown is
      // not a pass, and it is not a failure; it is the absence of an answer.
      this.logger.warn(`Execution feasibility annotation failed: ${(err as Error).message}`);
    }
  }

  /**
   * Build directive group panels from GatedScore breakouts.
   */
  /**
   * Shape a GatedScore's breakouts into the ordered group panels the UI renders.
   *
   * ⚠️ EXTRACTED 2026-09-28 (#926 follow-up). The body moved to
   * `common/utils/envelope-groups.ts` so the PERSISTED breakdown can be shaped by the SAME code
   * instead of a copy. The symbol page could otherwise only get shaped groups by running a full
   * scoring pass to re-derive them — which it did, 20 times per page view.
   *
   * ⚠️ Delegation, deliberately: two shapings of the same data is the one thing this must not
   * become, because only one of them would get the next fix.
   */
  private buildGroups(gated: GatedScore): SignalEnvelope['groups'] {
    return shapeEnvelopeGroups({ breakouts: gated.breakouts, subScores: gated.subScores });
  }

  /**
   * Compute a 0-100 confidence score from multiple signals:
   *  - Rarity band bonus
   *  - Distance from threshold
   *  - Group agreement (low variance = higher confidence)
   *  - Risk gate severity penalty
   */
  private computeConfidence(gated: GatedScore): number {
    let confidence = 50; // base

    // Rarity bonus
    if (gated.rarity) {
      const rarityBonuses: Record<string, number> = {
        'standard': 0,
        'strong': 10,
        'exceptional': 20,
        'cyclical': 15,
        'black-swan': -30,
      };
      confidence += rarityBonuses[gated.rarity.band] ?? 0;
    }

    // Distance from threshold
    const distance = gated.signalPct - 65;
    if (distance > 0) confidence += Math.min(distance * 0.5, 15);
    else confidence -= Math.min(Math.abs(distance) * 0.3, 15);

    // Group agreement: lower variance = higher confidence
    const scores = Object.values(gated.subScores).filter(s => s !== 50);
    if (scores.length >= 2) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev < 10) confidence += 10;
      else if (stdDev < 20) confidence += 5;
      else if (stdDev > 30) confidence -= 10;
    }

    // Risk gate penalty
    if (gated.riskGate?.hardGateTriggered) {
      confidence -= 25;
    }
    if (gated.riskMultiplier < 0.5) {
      confidence -= 15;
    } else if (gated.riskMultiplier < 0.7) {
      confidence -= 5;
    }

    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Detect directive conflicts: bull vs bear disagreement,
   * score divergence, or timeframe mismatches.
   *
   * #716 — gate groups (isRiskGate) are a MULTIPLIER path, not conviction.
   * Their subScore is structurally 0 (no directional contribution by design
   * in protocol-gating's signal aggregation). Including them here turned
   * every well-scoring signal into a fake "High-severity directive conflict"
   * (e.g. sentiment 77 vs risk 0 = 77pt spread). Gate groups are excluded
   * from both the bull/bear counts and the divergence spread.
   */
  private detectConflicts(gated: GatedScore, protocolId?: string): SignalEnvelope['conflicts'] {
    const conflicts: SignalEnvelope['conflicts'] = [];

    const gateIds = new Set<string>();
    if (protocolId) {
      for (const g of this.protocolDb.getCached(protocolId)?.groups ?? []) {
        if (g.isRiskGate) gateIds.add(g.id);
      }
    }

    const allBreakouts = Object.entries(gated.breakouts)
      .filter(([gid]) => !gateIds.has(gid))
      .flatMap(([, list]) => list);
    const bullish = allBreakouts.filter(b => b.signalClass === 'bullish');
    const bearish = allBreakouts.filter(b => b.signalClass === 'bearish');

    // Bull vs Bear conflict
    if (bullish.length > 0 && bearish.length > 0) {
      const bullAvg = bullish.reduce((s, b) => s + b.normalizedScore, 0) / bullish.length;
      const bearAvg = bearish.reduce((s, b) => s + b.normalizedScore, 0) / bearish.length;
      const gap = Math.abs(bullAvg - bearAvg);

      conflicts.push({
        type: 'bull_bear',
        severity: gap < 15 ? 'high' : gap < 30 ? 'medium' : 'low',
        description: `${bullish.length} bullish vs ${bearish.length} bearish directives (${gap.toFixed(0)}pt gap)`,
        directives: [
          ...bullish.map(b => b.name),
          ...bearish.map(b => b.name),
        ],
      });
    }

    // Score divergence: check if any NON-GATE, ACTIVE group's score deviates
    // significantly. Inactive groups (no directive results) are omitted from
    // subScores by the gating engine; this filter is defence-in-depth.
    const inactiveIds = new Set(gated.inactiveGroupIds ?? []);
    const scores = Object.entries(gated.subScores)
      .filter(([gid, v]) => !gateIds.has(gid) && !inactiveIds.has(gid) && v !== 50);
    if (scores.length >= 2) {
      const vals = scores.map(([, v]) => v);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      if (max - min > 40) {
        const maxGroup = scores.find(([, v]) => v === max)?.[0] ?? '?';
        const minGroup = scores.find(([, v]) => v === min)?.[0] ?? '?';
        conflicts.push({
          type: 'score_divergence',
          severity: max - min > 60 ? 'high' : 'medium',
          description: `${maxGroup} (${max.toFixed(0)}) vs ${minGroup} (${min.toFixed(0)}) — ${(max - min).toFixed(0)}pt spread`,
          directives: [],
        });
      }
    }

    return conflicts;
  }

  /**
   * Evaluate pre-trade readiness: are all gates clear?
   */
  private evaluatePreTrade(
    gated: GatedScore,
    conflicts: SignalEnvelope['conflicts'],
    // 65 -> 10 (2026-09-15): rescaled onto the post-ADR-011 percentage scale.
    // ADR-011 changed the denominator from the OBSERVED directional sum (~130) to the
    // CONFIGURED directional capacity (~725-815), dividing every percentage by ~6.3x.
    // A gate of 65 was therefore unreachable — measured peak `signalPct` is ~10-33 — and
    // live trading stopped on 2026-09-10. See the RESCALED block in
    // common/utils/style-thresholds.ts for the full derivation.
    gateThreshold = 10,
    gateLabel = '',
  ): {
    preTradeReady: boolean;
    preTradeBlockers: string[];
    /** Positionally parallel to `preTradeBlockerCodes` on the envelope. See `SignalEnvelope`. */
    preTradeBlockerCodes: string[];
  } {
    const blockers: string[] = [];
    // Built in the SAME branches as `blockers`, so the two can never disagree about how many
    // causes there were or which one came first.
    const blockerCodes: string[] = [];

    if (gated.riskGate?.hardGateTriggered) {
      blockers.push(`Hard gate: ${gated.riskGate.hardGateReason}`);
      blockerCodes.push('HARD_GATE');
    }
    if (gated.riskMultiplier < 0.3) {
      blockers.push(`Risk multiplier critically low (${(gated.riskMultiplier * 100).toFixed(0)}%)`);
      blockerCodes.push('RISK_MULTIPLIER_LOW');
    }
    if (conflicts.some(c => c.severity === 'high')) {
      blockers.push('High-severity directive conflict');
      blockerCodes.push('DIRECTIVE_CONFLICT');
    }
    if (gated.signalPct < gateThreshold) {
      // #718: threshold is per-protocol (override > style > default 65).
      // #687: classification uses the pre-gate percentage, not this gated
      // composite — phrase it as caution, not as a contradiction of the badge.
      // The gate's PROVENANCE is included so the number is never a mystery:
      // a silent style fall-through used to look identical to a real decision.
      blockers.push(
        `Signal below ${gateThreshold}% (${gated.signalPct.toFixed(1)}%)${gateLabel ? ` [${gateLabel}]` : ''}`,
      );
      blockerCodes.push('BELOW_GATE');
    }
    if (gated.marketStatus && !gated.marketStatus.open) {
      blockers.push(`Market unavailable: ${gated.marketStatus.reason ?? 'closed or stale'}`);
      blockerCodes.push('MARKET_UNAVAILABLE');
    }

    return {
      preTradeReady: blockers.length === 0,
      preTradeBlockers: blockers,
      preTradeBlockerCodes: blockerCodes,
    };
  }

  private getProtocolName(protocolId: string): string {
    return this.protocolDb.getCached(protocolId)?.name ?? protocolId;
  }

  /** Load `signals.gate.<protocolId>` overrides from global_setting (60s cache). */
  private async loadGateOverrides(): Promise<Map<string, number>> {
    const now = Date.now();
    if (this.gateOverrides && now - this.gateOverrides.loadedAt < 60_000) {
      return this.gateOverrides.map;
    }
    const map = new Map<string, number>();
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
        "SELECT `key`, value FROM global_setting WHERE `key` LIKE 'signals.gate.%'",
      );
      for (const r of rows) {
        const protocolId = r.key.slice('signals.gate.'.length);
        const v = parseInt(r.value, 10);
        if (protocolId && Number.isFinite(v)) map.set(protocolId, v);
      }
    } catch {
      /* DB unavailable — fall back to style/default */
    }
    this.gateOverrides = { loadedAt: now, map };
    return map;
  }

  /** Resolve the pre-trade gate: per-protocol override → style → 65 default. */
  private async getGateThreshold(protocolId?: string, tradingStyle?: string): Promise<StyleGateResolution> {
    if (protocolId) {
      const overrides = await this.loadGateOverrides();
      const override = overrides.get(protocolId);
      if (override !== undefined) {
        return {
          threshold: override,
          source: 'override',
          label: `override signals.gate.${protocolId} = ${override}`,
        };
      }
    }
    return resolveStyleThreshold(tradingStyle, SIGNALS_GATE_DEFAULT);
  }

  /**
   * Reconcile the style-derived gate against the bots that actually execute
   * this signal (#759).
   *
   * ⚠️ WHY THIS IS NEEDED, AND WHY IT ONLY EVER LOWERS
   * --------------------------------------------------
   * Two independent thresholds decide whether a signal becomes an order:
   *
   *   the pre-trade gate  — from the protocol's trading STYLE (65 for day-trade)
   *   the bot's minComposite — the bar the BOT was deliberately configured with
   *
   * Nothing reconciled them, so a bot could be configured to act at 55 and be
   * starved by a gate of 65 it never mentioned. Measured live: `forex-session-v1`
   * scored USDJPY/USDCAD/USDCHF at 50/50/50.6, the gate held them at 65, and the
   * bots set to 55–60 were never offered the decision. The signal was dropped
   * before reaching the component whose configured intent governs it.
   *
   * The operator's explicit per-bot bar WINS, because it is the more specific
   * declaration — the same precedence this codebase already applies to
   * directive maxScore (protocol override → global config → directive class).
   *
   * It LOWERS ONLY, and only as far as the LOWEST participating bot bar. It
   * never raises the gate, so a style that legitimately demands more (scalp 75,
   * speed 80) is untouched for bots that agree with it; and it cannot make a
   * threshold stricter than the operator asked for. A `signals.gate.<protocol>`
   * OVERRIDE still wins outright — that is a deliberate human instruction, and
   * a convenience rule must not silently overrule it. Both facts are recorded in
   * the returned label so the number is never a mystery.
   *
   * Returns the gate unchanged when no bot participates: a protocol scored for
   * display only (no subscription) keeps its style bar, because there is no
   * operator intent to defer to.
   */
  private async reconcileGateWithBots(
    resolution: StyleGateResolution,
    protocolId?: string,
  ): Promise<StyleGateResolution> {
    if (!protocolId) return resolution;
    // An explicit override is an instruction, not a default. Never second-guess it.
    if (resolution.source === 'override') return resolution;

    try {
      // ── #759 CORRECTED 2026-10-06 — "participating" resolves through SUBSCRIPTIONS ────────────
      //
      // This read `tradingStrategy.protocolId` — the column `bot-rules.ts` declares `display-only`,
      // whose own caveat says routing uses `strategy_protocol` — while `SignalQueueService.syncQueues()`,
      // the thing that actually creates entries, joins `strategy_protocol`. Two sources for one
      // question, with both failure modes live: a SUBSCRIBED bot whose `protocolId` column had
      // drifted never lowered the gate (the #759 starvation, returning by another door), and a bot
      // carrying the column but no subscription could lower the gate for a protocol it can never
      // trade. Measured before this change: all 40 active bots AGREE between the two sources, so
      // the gate value is unchanged today. Canaries pinning both directions:
      // `signal-envelope-gate-reconciliation.spec.ts`.
      const subscriptions = await this.prisma.strategyProtocol.findMany({
        where: { protocolId },
        select: { strategyId: true },
      });
      const subscribedIds = [...new Set(subscriptions.map((s) => s.strategyId))];
      const bots = subscribedIds.length === 0
        ? []
        : await this.prisma.tradingStrategy.findMany({
            where: { id: { in: subscribedIds }, active: true },
            select: { minComposite: true, mode: true, symbol: true },
          });
      const bars = bots
        .map((b) => Number((b as { minComposite?: number | null }).minComposite ?? 0))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (bars.length === 0) return resolution;

      const lowestBotBar = Math.min(...bars);
      if (lowestBotBar >= resolution.threshold) return resolution;

      return {
        threshold: lowestBotBar,
        source: 'style',
        style: resolution.style,
        label: `${resolution.label}, reconciled down to the lowest participating bot bar (${lowestBotBar})`,
      };
    } catch {
      // Bot lookup is best-effort — never let it change the gate by accident.
      return resolution;
    }
  }

  private emptyEnvelope(symbol: string): SignalEnvelope {
    return {
      symbol,
      composite: 50,
      maxPossible: 100,
      signal: 'HOLD',
      confidence: 0,
      rarity: null,
      rarityColor: null,
      riskGate: { active: false, multiplier: 1, triggered: false, reason: null, chain: [], warnings: [] },
      groups: [],
      conflicts: [],
      preTradeReady: false,
      preTradeBlockers: ['No market data available'],
      preTradeBlockerCodes: ['NO_MARKET_DATA'],
      scoredAt: new Date().toISOString(),
      protocolId: null,
      protocolName: null,
      directionMode: 'LONG_ONLY',
      scoreId: null,
      signalPct: null,
      opportunityPct: null,
      combinedStrength: 0,
      marketStatus: null,
      holdsCfd: false,
      executionBlockers: [],
    };
  }

  /**
   * Get a single symbol's envelope with full directive drilldown.
   *
   * Without an explicit protocol, only symbols that an ACTIVE protocol
   * actually resolves may be scored — page views of arbitrary symbols
   * (e.g. a symbol just registered on a fresh watchlist) must NOT fall
   * through to the 'default' protocol and persist default Score rows.
   */
  async getDrilldown(ticker: string, protocolId?: string): Promise<SignalEnvelope> {
    if (!protocolId) {
      const covered = await this.isCoveredByActiveProtocol(ticker);
      if (!covered) {
        const env = this.emptyEnvelope(ticker);
        env.preTradeBlockers = ['Not included in any active protocol — no score produced'];
      env.preTradeBlockerCodes = ['NOT_IN_PROTOCOL'];
        return env;
      }
    }

    const env = await this.buildEnvelope(ticker, protocolId);

    // ── DECISION (#935, 2026-09-27, primary) ──────────────────────────────────────────────
    // WHAT:  The single-symbol drilldown now carries `executionBlockers`, assessed with the SAME
    //        `ExecutionFeasibilityService` call the ladder (#723) and the order path use.
    // WHY:   SymbolPage rendered `preTradeReady` ALONE as "✓ Trade Ready". That field covers the
    //        pre-trade gate only; the ORDER path additionally requires
    //        `executionBlockers.length === 0` (see `isRouteable()` in buildBestLadder) plus the
    //        broker's tradeMode and volume floor. Measured: this endpoint returned NO
    //        `executionBlockers` at all — `undefined`, not `[]` — so the card could not have been
    //        right even in principle, and a frontend-only fix could not have been correct.
    // INSTEAD OF: Reading `executionBlockers` in the frontend, as #935 proposed. The field was
    //        ABSENT from this endpoint, so a frontend-only fix would have read `undefined` and
    //        concluded "no blockers" — the same defect wearing a new hat.
    // REVERSE BY: Delete this call and the `tradeReadiness()` consumer in src/core/trade-readiness.js.
    // REGISTER:  docs/SETTLED-DECISIONS.md
    // GUARD:     nest/src/modules/signals/signal-envelope-readiness.spec.ts
    //            + src/core/trade-readiness.test.js
    // ──────────────────────────────────────────────────────────────────────────────────────
    await this.annotateFeasibility(env, protocolId);

    return env;
  }

  /** True when at least one ACTIVE protocol resolves this ticker as a symbol. */
  private async isCoveredByActiveProtocol(ticker: string): Promise<boolean> {
    try {
      const clean = ticker.toUpperCase();
      const active = await this.protocolDb.findAllActive();
      for (const slug of active) {
        const symbols = (await this.protocolDb.resolveSymbols(slug)).map((s) => s.toUpperCase());
        if (symbols.includes(clean)) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Persist scored envelopes to the Score table so they appear in
   * scoring-runs and scoring-activity-logs pages.
   * Returns a map of symbol → persisted Score row id (#684 — the id is
   * required by GET /api/signals/:id/action and POST /api/signals/:id/trade).
   */
  private async persistScores(
    envelopes: SignalEnvelope[],
    strategyId: string,
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    const strategy = await this.ensureStrategy(strategyId);

    for (const env of envelopes) {
      if (env.composite === 50 && env.signal === 'HOLD' && env.confidence === 0) {
        continue; // Skip empty/no-data envelopes
      }

      try {
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: env.symbol },
          select: { id: true },
        });
        if (!sym) continue;

        // ── Reuse the gating row instead of shadowing it ────────────────────
        //
        // The protocol-gating pipeline already wrote a Score row for this
        // (symbol, protocol) moments ago. That row carries the full breakdown
        // (`rawMax`, `marketStatus`, `denominatorMode`, `readinessGate` — 21
        // keys); this write only carries 8. Creating a second row made EVERY
        // scored symbol a duplicate pair, with the thin row newer — so the
        // scoring-runs grouping (which reads `entries[0]` from a timestamp-desc
        // fetch) picked the thin one and the ladder lost the denominator and
        // the market status.
        //
        // If a gating row exists in this same minute we adopt its id and leave
        // it in place. `scoreId` — the only thing this method's callers need —
        // is still returned, and the rich breakdown is preserved.
        const existingRows = await (this.prisma as any).$queryRawUnsafe(
          `SELECT id FROM Score
            WHERE symbolId = ? AND strategyId = ?
              AND timestamp >= ?
              AND JSON_UNQUOTE(JSON_EXTRACT(breakdown, '$.protocolId')) IS NOT NULL
            ORDER BY timestamp DESC LIMIT 1`,
          sym.id,
          strategy.id,
          new Date(Date.now() - 60_000),
        ) as Array<{ id: string }>;
        const existing = existingRows?.[0] ?? null;
        if (existing?.id) {
          ids[env.symbol] = existing.id;
          this.signalOutcomes.recordOutcome({
            scoreId: existing.id,
            symbol: env.symbol,
            protocolId: env.protocolId ?? (strategyId !== SIGNALS_WORKBENCH_STRATEGY_ID ? strategyId : null),
            preTradeReady: env.preTradeReady,
            blockers: env.preTradeBlockers,
            conflicts: env.conflicts,
            warnings: env.riskGate?.warnings ?? [],
            executionBlockers: env.executionBlockers ?? [],
          }).catch(() => {});
          continue;
        }

        const snapshot = await this.scoreHistory.storeSnapshot(
          sym.id,
          strategy.id,
          env.composite,
          {
            signal: env.signal,
            confidence: env.confidence,
            rarity: env.rarity,
            source: 'signals-workbench',
            protocolId: strategyId !== SIGNALS_WORKBENCH_STRATEGY_ID ? strategyId : null,
            riskMultiplier: env.riskGate.multiplier,
            preTradeReady: env.preTradeReady,
            blockerCount: env.preTradeBlockers.length,
          },
        );
        if (snapshot?.id) {
          ids[env.symbol] = snapshot.id;
          // #717 — persist WHY this signal is (or isn't) trade-ready,
          // keyed to the signal's Score id (write-on-change).
          this.signalOutcomes.recordOutcome({
            scoreId: snapshot.id,
            symbol: env.symbol,
            protocolId: env.protocolId ?? (strategyId !== SIGNALS_WORKBENCH_STRATEGY_ID ? strategyId : null),
            preTradeReady: env.preTradeReady,
            blockers: env.preTradeBlockers,
            conflicts: env.conflicts,
            warnings: env.riskGate?.warnings ?? [],
            executionBlockers: env.executionBlockers ?? [],
          }).catch(() => {});
        }
      } catch (err) {
        this.logger.warn(
          `Failed to persist score for ${env.symbol}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Persisted ${envelopes.filter(e => e.confidence > 0).length} signal scores to DB (strategy: ${strategyId})`,
    );
    return ids;
  }

  /**
   * Build the Signals v1 best-of ladder (#684).
   * ===========================================
   * Every ACTIVE protocol is scored; one card survives per symbol per
   * direction (the best protocol wins on combined strength). HOLD envelopes
   * and no-data envelopes are dropped — signals are for action only.
   * Dismissed (symbol, protocol) pairs are filtered out.
   */
  async buildBestLadder(options?: { allowedProtocols?: Set<string> }): Promise<SignalBestResponse & { protocolStatus: Record<string, ProtocolScoreStatus> }> {
    const slugs = await this.protocolDb.findAllActive();
    const allowed = options?.allowedProtocols;
    const byKey = new Map<string, SignalEnvelope>();

    // Per-protocol scoring status — returned so the loop can persist
    // protocol_score_status without a second scoring pass (#714 single line).
    const protocolStatus: Record<string, ProtocolScoreStatus> = {};

    // Preserve every actionable protocol result until feasibility and
    // persistence complete. Routing before those steps loses decision lineage.
    const scoredPairs = new Set<string>();
    const scoredEnvelopes: SignalEnvelope[] = [];
    // #600 — highest signal percentage per protocol this run, persisted below.
    const maxCompositeBySlug = new Map<string, number>();

    for (const slug of slugs) {
      // #627 readiness gate — the loop passes its assessed-ready set so
      // non-ready (beta) directives never produce signals.
      if (allowed && !allowed.has(slug)) {
        protocolStatus[slug] = { state: 'paused', reason: 'Readiness gate — directives not ready' };
        continue;
      }

      const config = this.protocolDb.getCached(slug) ?? (await this.protocolDb.findBySlug(slug));
      if (!config) continue;

      let tickers: string[];
      try {
        tickers = await this.protocolDb.resolveSymbols(slug);
      } catch {
        protocolStatus[slug] = { state: 'error', reason: 'resolveSymbols failed' };
        continue;
      }
      if (!tickers || tickers.length === 0) {
        protocolStatus[slug] = {
          state: 'no-symbols',
          symbolsResolved: 0,
          symbolsScored: 0,
          reason: 'No symbols configured — needs a symbol assignment, linked watchlist, or derive rule',
        };
        continue;
      }

      // ── Venue standby (2026-09-19) — a closed venue produces NO FRESH SCORE ──────────────
      // BEFORE: XAUUSD was scored every weekend tick. Its 5m bar stayed "0 min old" because
      // bar-refresh writes a synthetic bar from the last quote (see bar-refresh.service.ts
      // "Also upsert synthetic 'current' bars from live quotes"), so the freshness-only gate
      // said open, envelopes were built, and a BUY card was served on signals-overview for a
      // market that had been closed since Friday 22:00 London. The block only arrived later,
      // at queue dispatch ("last real bar 60m old"). The user's words: "there shouldn't be a
      // signal, because there shouldn't be a fresh score either."
      // AFTER: ask the SHARED venue classifier (protocol-gating.getVenueStandby — same
      // venueForSymbol + same MarketCalendarService as the per-envelope marketStatus, so the
      // scoring gate and the serving gate cannot disagree). Standby skips scoring entirely
      // and records why in protocol_score_status, where the Protocols page renders it.
      const venueGate = this.protocolGating.getVenueStandby(tickers);
      if (venueGate.standby) {
        protocolStatus[slug] = {
          state: 'standby',
          symbolsResolved: tickers.length,
          symbolsScored: 0,
          reason: venueGate.reason,
        };
        continue;
      }

      let protoScored = 0;
      for (const ticker of tickers) {
        try {
          const env = await this.buildEnvelope(ticker, slug);
          const sym = ticker.toUpperCase();
          // #758 — a NO_DATA envelope is an ABSENCE, not a score. Counting it as scored is
          // what let a protocol report 'scoring' for hours while producing nothing usable:
          // the phantom `0/0 -> 0` tick incremented this counter. It still counts as a
          // RESOLVED pair (we did look at it), but not as a reading.
          const noData = (env as any).noData === true || env.signal === ('NO_DATA' as any);
          if (noData) continue;
          scoredPairs.add(`${slug}|${sym}`);
          protoScored++;
          // #600 — protocol maxima are comparable only after normalization.
          const prev = maxCompositeBySlug.get(slug) ?? 0;
          if ((env.signalPct ?? 0) > prev) maxCompositeBySlug.set(slug, env.signalPct ?? 0);
          // Action-only (#684): skip HOLD and no-data envelopes for display.
          if (env.signal === 'HOLD') continue;
          if (env.composite === 50 && env.confidence === 0) continue;

          scoredEnvelopes.push(env);

          // ⚠️ The dedupe key is `symbol|direction` — "best protocol wins per symbol PER DIRECTION".
          // A prefix test here put a STRONG_SELL into the LONG bucket, where it could displace a
          // genuine long envelope and vice versa. `UNKNOWN` is its own bucket rather than sharing
          // a bucket with longs.
          const direction = signalToDirection(env.signal) ?? 'UNKNOWN';
          const key = `${sym}|${direction}`;
          const existing = byKey.get(key);
          if (!existing || env.combinedStrength > existing.combinedStrength) {
            byKey.set(key, env);
          }
        } catch (err) {
          this.logger.warn(`Best ladder skip ${ticker}/${slug}: ${(err as Error).message}`);
        }
      }

      protocolStatus[slug] = protoScored > 0
        ? {
            state: 'scoring',
            symbolsResolved: tickers.length,
            symbolsScored: protoScored,
            reason: protoScored < tickers.length
              ? `${protoScored}/${tickers.length} symbols produced a directional reading (the rest were no-data or failed) — see #758`
              : undefined,
          }
        : {
            state: 'no-data',
            symbolsResolved: tickers.length,
            symbolsScored: 0,
            reason: `No symbol produced a directional reading — every direction-eligible directive read neutral or data was missing (${tickers.length} symbol(s) resolved). An all-neutral tick is data absence, not a HOLD score (#758).`,
          };
    }

    // #600 — persist per-protocol highest-ever composite (survives Score
    // pruning). Atomic bump: only updates when the new peak exceeds the
    // stored value (or none exists yet).
    for (const [slug, peak] of maxCompositeBySlug) {
      try {
        await this.prisma.protocol.updateMany({
          where: { slug, OR: [{ highestScore: null }, { highestScore: { lt: peak } }] },
          data: { highestScore: peak },
        });
      } catch (err) {
        this.logger.warn(`Highest-score persist failed for ${slug}: ${(err as Error).message}`);
      }
    }

    const envelopes = [...byKey.values()];

    // ── MT5 CFD position context (#684) + #723 execution blockers ──
    let held = new Set<string>();
    let mt5Positions: any[] = [];
    try {
      const mt5 = this.adapterFactory.create('mt5');
      if (mt5?.getPositions) {
        mt5Positions = (await mt5.getPositions()) ?? [];
        held = new Set(mt5Positions.map(p => (p.symbol || '').toUpperCase()));
      }
    } catch {
      /* broker offline — holdsCfd stays false */
    }
    for (const env of scoredEnvelopes) {
      env.holdsCfd = held.has(env.symbol.toUpperCase());
    }

    // Resolve the executing bot (TradingStrategy) per symbol+protocol, so the
    // UI can distinguish "protocol" (signal thesis) from "bot" (execution
    // policy). Best-effort: a signal without a matching bot stays null.
    //
    // ⚠️ `baseSize` IS CARRIED HERE, AND IT IS LOAD-BEARING (#972, 2026-09-22).
    //
    // The feasibility assessment below used to size EVERY envelope from
    // `signals.manualTrade.size` — the SIGNALS-CARD default for a human click. That is the wrong
    // number for a bot-driven envelope: the bot has its own `baseSize`, and it is the bot's size
    // the broker floor applies to when it trades. Measured: `signals.manualTrade.size` was lowered
    // 0.1 -> 0.01 on 2026-09-22 and VIX immediately became unroutable — its Pepperstone floor is
    // **0.1**, so `0.01 < 0.1` raised a `size-below-minimum` execution blocker on a signal the bot
    // would have placed at 0.1. The blocker is not decoration: `isRouteable()` requires
    // `executionBlockers.length === 0`, so VIX could never be queued and never traded — from a
    // setting that has nothing to do with it. One value doing duty for another is the same defect
    // as the two-sources problems filed today (#948, #951); here it silently disabled a symbol.
    const botByKey = new Map<string, { name: string; baseSize: number | null }>();
    try {
      const bots = await this.prisma.tradingStrategy.findMany({
        where: { active: true },
        select: { name: true, protocolId: true, symbol: true, baseSize: true },
      });
      for (const b of bots) {
        if (b.protocolId) {
          botByKey.set(`${b.protocolId}|${b.symbol.toUpperCase()}`, {
            name: b.name,
            baseSize: b.baseSize ?? null,
          });
        }
      }
    } catch {
      /* bot lookup is best-effort */
    }
    for (const env of scoredEnvelopes) {
      env.botName = botByKey.get(`${env.protocolId}|${env.symbol.toUpperCase()}`)?.name ?? null;
    }

    // #723 — feasibility at generation: the SAME assessment the execution
    // path re-runs. Uses the positions already fetched above + the cached
    // broker symbol list, so the card explains blockers before any click.
    try {
      // ⚠️ #914 — the persisted manual-trade default SIZE is passed in, because it is one of
      // the facts the assessment needs. Without it the volume-floor check short-circuits at
      // generation, so `size-below-minimum` could only ever fire AFTER the click — the opposite
      // of what this two-phase design is for. A failure to read settings degrades to "unknown",
      // never to a fabricated number.
      const tradeDefaults = await this.tradeDefaults?.getDefaults().catch(() => null);
      for (const env of scoredEnvelopes) {
        // ⚠️ #935 — ONE assessment implementation, shared with the drilldown. This loop used to
        // carry its OWN copy of it, and that duplication is exactly how the two paths drifted
        // apart: the ladder blocked a symbol that the drilldown still drew as "✓ Trade Ready".
        // The batched size/position resolution stays here (one bot query for N envelopes); only
        // the assessment itself moved into the helper.
        await this.annotateFeasibility(env, env.protocolId, {
          positions: mt5Positions,
          // ⚠️ The size that will ACTUALLY BE TRADED, not a proxy for it (#972).
          // A bot envelope is sized by its bot; only a signal with no executing bot falls back to
          // the manual default, because only then does a human click the card.
          size: botByKey.get(`${env.protocolId}|${env.symbol.toUpperCase()}`)?.baseSize
            ?? tradeDefaults?.size
            ?? null,
        });
      }
    } catch (err) {
      this.logger.warn(`Execution feasibility annotation failed: ${(err as Error).message}`);
    }

    // ── Persist + assign score ids (required for /:id/action and /:id/trade) ──
    const byProtocol = new Map<string, SignalEnvelope[]>();
    for (const env of scoredEnvelopes) {
      const pid = env.protocolId ?? SIGNALS_WORKBENCH_STRATEGY_ID;
      if (!byProtocol.has(pid)) byProtocol.set(pid, []);
      byProtocol.get(pid)!.push(env);
    }
    for (const [pid, envs] of byProtocol) {
      try {
        const ids = await this.persistScores(envs, pid);
        for (const env of envs) {
          if (ids[env.symbol]) env.scoreId = ids[env.symbol];
        }
      } catch (err) {
        this.logger.warn(`Best-ladder persistence failed for ${pid}: ${(err as Error).message}`);
      }
    }

    // ── Dismissal filter (#684) — default horizon 1h, Screen Option can extend ──
    let dismissed = new Set<string>();
    try {
      const rows: any[] = await (this.prisma as any).signalDismissal.findMany({
        where: { dismissedUntil: { gt: new Date() } },
        select: { symbol: true, protocolId: true },
      });
      dismissed = new Set(rows.map(r => `${r.symbol.toUpperCase()}|${r.protocolId}`));
    } catch {
      /* table may not exist yet */
    }

    const visible = envelopes
      .filter(e => !dismissed.has(`${e.symbol}|${e.protocolId}`))
      .sort((a, b) => b.combinedStrength - a.combinedStrength);

    // 2026-09-08: route only feasible, persisted decisions. The old path built
    // queue records before feasibility and persistence, so blockers and score
    // lineage disappeared and a raw composite was stored as a percentage.
    try {
      const isRouteable = (env: typeof scoredEnvelopes[number]): boolean =>
        env.preTradeReady &&
        (env.executionBlockers?.length ?? 0) === 0 &&
        Boolean(env.scoreId) &&
        !dismissed.has(`${env.symbol}|${env.protocolId}`) &&
        // ⚠️ A signal whose direction cannot be derived must not route. Previously an
        // underivable class fell through to LONG/BUY and was queued as a BUY.
        signalToDirection(env.signal) !== null;

      const routeable: RoutableSignal[] = scoredEnvelopes
        .filter(isRouteable)
        .map(env => ({
          protocolId: env.protocolId!,
          symbol: env.symbol,
          // Non-null by the `isRouteable` guard above — the single authority, not a prefix test.
          direction: signalToDirection(env.signal)!,
          signal: signalToSide(env.signal)!,
          compositePct: env.signalPct,
          signalPct: env.signalPct,
          opportunityPct: env.opportunityPct,
          combinedStrength: env.combinedStrength,
          scoreId: env.scoreId,
        }));

      // Explain everything that did NOT become routeable, so the queue log can
      // report "signalled but blocked (why)" instead of the misleading
      // "dropped non-signalling symbol(s)". A symbol blocked by the 65%
      // pre-trade gate used to be reported as though the PROTOCOL had never
      // signalled — which sent two separate investigations after the wrong
      // component. Keep this map in step with the isRouteable() filter above.
      const notRouteable = new Map<string, { code: string; reason: string }>();
      for (const env of scoredEnvelopes) {
        if (isRouteable(env) || !env.protocolId) continue;
        let why: string;
        // The MACHINE code is the FIRST blocker's code, because blockers are pushed in the order
        // the gates run and the first is the one that fired first. `codes` keeps every code so a
        // signal blocked on two grounds is not reported as blocked on one.
        let codes: string[] = env.preTradeBlockerCodes ?? [];
        if (env.preTradeBlockers?.length) {
          why = env.preTradeBlockers.join('; ');
        } else if (env.executionBlockers?.length) {
          codes = ['EXECUTION_BLOCKER'];
          why = env.executionBlockers
            .map((b: any) => b?.reason ?? b?.code ?? b?.message ?? 'execution blocker')
            .join('; ');
        } else if (!env.scoreId) {
          codes = ['NO_SCORE_LINEAGE'];
          why = 'no score lineage';
        } else if (signalToDirection(env.signal) === null) {
          // ⚠️ Must be checked BEFORE the final `else`, or this case is misreported as
          // 'dismissed' — which is the same shape as the original bug: a real cause labelled as
          // something it is not, sending the next investigation after the wrong component.
          codes = ['NO_DIRECTION'];
          why = `signal class "${env.signal}" has no derivable direction`;
        } else {
          codes = ['DISMISSED'];
          why = 'dismissed';
        }
        // `UNCODED` is a real value, not a placeholder: it says the cause was recorded before the
        // code existed, or came from a path that does not classify. It must not read as 'no cause'.
        notRouteable.set(`${env.protocolId}|${env.symbol}`, {
          code: codes[0] ?? 'UNCODED',
          reason: why,
        });
      }

      await this.signalQueue.syncQueues(routeable, scoredPairs, notRouteable);
    } catch (err) {
      this.logger.warn(`Signal queue routing failed: ${(err as Error).message}`);
    }

    // ── Rank snapshot (#693) — hourly throttle. Persists the visible ranking so
    // forward outcomes can validate combinedStrength without paper assumptions. ──
    try {
      const last: any[] = await (this.prisma as any).$queryRawUnsafe(
        'SELECT MAX(runAt) AS lastRun FROM signal_rank_snapshot',
      );
      const lastRun = last?.[0]?.lastRun;
      if (!lastRun || Date.now() - new Date(lastRun).getTime() >= 60 * 60_000) {
        await (this.prisma as any).signalRankSnapshot.createMany({
          data: visible.map((e, i) => ({
            symbol: e.symbol,
            protocolId: e.protocolId ?? 'any',
            direction: e.directionMode === 'SHORT_ONLY' ? 'SHORT' : 'LONG',
            rank: i + 1,
            combinedStrength: Math.round(e.combinedStrength || 0),
            signalPct: e.signalPct != null ? Math.round(e.signalPct) : null,
            opportunityPct: e.opportunityPct != null ? Math.round(e.opportunityPct) : null,
            confidence: e.confidence != null ? Math.round(e.confidence) : null,
            scoreId: e.scoreId ?? null,
          })),
        });
        this.logger.log(`Rank snapshot persisted: ${visible.length} cards`);
      }
    } catch (err) {
      this.logger.warn(`Rank snapshot failed: ${(err as Error).message}`);
    }

    const buyCount = visible.filter(e => isBuySignal(e.signal)).length;
    const sellCount = visible.filter(e => isSellSignal(e.signal)).length;

    return {
      generatedAt: new Date().toISOString(),
      activeProtocols: slugs.length,
      totalSymbols: visible.length,
      buyCount,
      sellCount,
      envelopes: visible,
      protocolStatus,
    };
  }

  /**
   * Dismiss a signal for `hours` (default 1). Keyed on symbol+protocol so a
   * dismissal survives reloads and re-scoring runs (#684).
   *
   * Strength fields (#693) capture what the user saw at dismissal time —
   * stored for dismissal analytics and threshold calibration.
   */
  async dismissSignal(
    symbol: string,
    protocolId: string | undefined,
    hours = 1,
    strengths?: { combinedStrength?: number; signalPct?: number; opportunityPct?: number },
  ): Promise<{ symbol: string; protocolId: string; dismissedUntil: string }> {
    const cleanSymbol = symbol.toUpperCase();
    const pid = protocolId || 'any';
    const dismissedUntil = new Date(Date.now() + hours * 3_600_000);

    try {
      await (this.prisma as any).signalDismissal.upsert({
        where: { symbol_protocolId: { symbol: cleanSymbol, protocolId: pid } },
        create: {
          symbol: cleanSymbol,
          protocolId: pid,
          dismissedUntil,
          combinedStrength: strengths?.combinedStrength ?? null,
          signalPct: strengths?.signalPct ?? null,
          opportunityPct: strengths?.opportunityPct ?? null,
        },
        update: {
          dismissedUntil,
          combinedStrength: strengths?.combinedStrength ?? undefined,
          signalPct: strengths?.signalPct ?? undefined,
          opportunityPct: strengths?.opportunityPct ?? undefined,
          dismissCount: { increment: 1 },
        },
      });
      // #714 — dismissal propagates into the trading-bot queues.
      await this.signalQueue.removePendingForSignal(cleanSymbol, pid === 'any' ? undefined : pid);
    } catch (err) {
      this.logger.warn(`Dismiss failed for ${cleanSymbol}/${pid}: ${(err as Error).message}`);
    }

    return { symbol: cleanSymbol, protocolId: pid, dismissedUntil: dismissedUntil.toISOString() };
  }

  /** Active dismissals — used by the page's "show dismissed" toggle (#684). */
  async getDismissals(): Promise<Array<{ symbol: string; protocolId: string; dismissedUntil: string }>> {
    try {
      const rows: any[] = await (this.prisma as any).signalDismissal.findMany({
        where: { dismissedUntil: { gt: new Date() } },
        orderBy: { dismissedUntil: 'desc' },
      });
      return rows.map((r: any) => ({
        symbol: r.symbol,
        protocolId: r.protocolId,
        dismissedUntil: r.dismissedUntil instanceof Date ? r.dismissedUntil.toISOString() : String(r.dismissedUntil),
      }));
    } catch {
      return [];
    }
  }

  /**
   * GET /api/signals/analytics (#693)
   *
   * Non-executive feedback-loop observability:
   *   - dismissal analytics (totals, per protocol, per strength band)
   *   - forward outcomes correlated against REAL trades (source='signals')
   *   - rank validation: latest snapshot rank of traded symbols vs all symbols
   *
   * Observability only — no auto-trading changes are driven by this data yet.
   */
  async getAnalytics() {
    const q = async (sql: string): Promise<any[]> => {
      try {
        return (await (this.prisma as any).$queryRawUnsafe(sql)) as any[];
      } catch (err) {
        this.logger.warn(`analytics query failed: ${(err as Error).message}`);
        return [];
      }
    };
    const first = (rows: any[]) => rows?.[0] ?? {};

    const [
      dSummary,
      dByProtocol,
      dBands,
      oSummary,
      oByProtocol,
      rankAll,
      rankTraded,
    ] = await Promise.all([
      q(`SELECT CAST(COUNT(*) AS SIGNED) AS total,
                CAST(SUM(dismissedUntil > UTC_TIMESTAMP()) AS SIGNED) AS active,
                CAST(SUM(combinedStrength IS NOT NULL) AS SIGNED) AS withStrength
         FROM signal_dismissal`),
      q(`SELECT protocolId,
                CAST(SUM(dismissCount) AS SIGNED) AS n,
                CAST(ROUND(AVG(combinedStrength)) AS SIGNED) AS avgStrength
         FROM signal_dismissal
         GROUP BY protocolId
         ORDER BY n DESC LIMIT 8`),
      q(`SELECT CASE
                  WHEN combinedStrength < 50 THEN '0-49'
                  WHEN combinedStrength < 60 THEN '50-59'
                  WHEN combinedStrength < 70 THEN '60-69'
                  ELSE '70+'
                END AS band,
                CAST(COUNT(*) AS SIGNED) AS n
         FROM signal_dismissal
         WHERE combinedStrength IS NOT NULL
         GROUP BY band`),
      q(`SELECT CAST(COUNT(*) AS SIGNED) AS traded,
                CAST(SUM(status = 'open') AS SIGNED) AS openCount,
                CAST(SUM(status <> 'open') AS SIGNED) AS closedCount,
                CAST(SUM(status <> 'open' AND pnl > 0) AS SIGNED) AS won,
                CAST(SUM(status <> 'open' AND pnl <= 0) AS SIGNED) AS lost
         FROM trade
         WHERE source = 'signals'`),
      q(`SELECT scoringStrategyId AS protocolId,
                CAST(COUNT(*) AS SIGNED) AS n,
                CAST(SUM(status <> 'open') AS SIGNED) AS closed,
                CAST(SUM(status <> 'open' AND pnl > 0) AS SIGNED) AS won
         FROM trade
         WHERE source = 'signals'
         GROUP BY scoringStrategyId
         ORDER BY n DESC LIMIT 8`),
      q(`SELECT CAST(COUNT(*) AS SIGNED) AS snapshots,
                CAST(ROUND(AVG(rn)) AS SIGNED) AS avgRankAll
         FROM (
           SELECT s1.\`rank\` AS rn FROM signal_rank_snapshot s1
           JOIN (SELECT symbol, direction, MAX(runAt) AS maxRun
                 FROM signal_rank_snapshot GROUP BY symbol, direction) s2
             ON s1.symbol = s2.symbol AND s1.direction = s2.direction AND s1.runAt = s2.maxRun
         ) x`),
      q(`SELECT CAST(ROUND(AVG(rn)) AS SIGNED) AS avgRankTraded,
                CAST(COUNT(*) AS SIGNED) AS tradedSymbols
         FROM (
           SELECT s1.\`rank\` AS rn FROM signal_rank_snapshot s1
           JOIN (SELECT symbol, direction, MAX(runAt) AS maxRun
                 FROM signal_rank_snapshot GROUP BY symbol, direction) s2
             ON s1.symbol = s2.symbol AND s1.direction = s2.direction AND s1.runAt = s2.maxRun
           WHERE s1.symbol IN (SELECT DISTINCT symbol FROM trade WHERE source = 'signals')
         ) x`),
    ]);

    const o = first(oSummary);
    const closed = Number(o.closedCount ?? 0);
    const won = Number(o.won ?? 0);

    return {
      generatedAt: new Date().toISOString(),
      mode: 'observability',
      dismissals: {
        total: Number(first(dSummary).total ?? 0),
        active: Number(first(dSummary).active ?? 0),
        withStrength: Number(first(dSummary).withStrength ?? 0),
        byProtocol: dByProtocol.map((r: any) => ({
          protocolId: r.protocolId,
          count: Number(r.n ?? 0),
          avgStrength: r.avgStrength != null ? Number(r.avgStrength) : null,
        })),
        bands: dBands.map((r: any) => ({ band: r.band, count: Number(r.n ?? 0) })),
      },
      outcomes: {
        traded: Number(o.traded ?? 0),
        open: Number(o.openCount ?? 0),
        closed,
        won,
        lost: Number(o.lost ?? 0),
        winRate: closed > 0 ? Math.round((won / closed) * 100) : null,
        byProtocol: oByProtocol.map((r: any) => ({
          protocolId: r.protocolId,
          count: Number(r.n ?? 0),
          closed: Number(r.closed ?? 0),
          won: Number(r.won ?? 0),
        })),
      },
      ranks: {
        snapshots: Number(first(rankAll).snapshots ?? 0),
        avgRankAll: first(rankAll).avgRankAll != null ? Number(first(rankAll).avgRankAll) : null,
        avgRankTraded: first(rankTraded).avgRankTraded != null ? Number(first(rankTraded).avgRankTraded) : null,
        tradedSymbols: Number(first(rankTraded).tradedSymbols ?? 0),
      },
    };
  }

  /**
   * Find or create the strategy used to tag persisted scores.
   */
  private async ensureStrategy(strategyId: string): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: { id: true, name: true },
    });
    if (existing) return existing;

    // Create a placeholder strategy for signals-workbench
    const created = await this.prisma.strategy.create({
      data: {
        id: strategyId,
        name: strategyId === SIGNALS_WORKBENCH_STRATEGY_ID
          ? 'Signals Workbench'
          : `Signals Workbench — ${strategyId}`,
        description: 'Auto-created for Signals Workbench score persistence',
        config: {},
      },
      select: { id: true, name: true },
    });

    this.logger.log(`Created placeholder strategy "${created.name}" (${created.id})`);
    return created;
  }
}
