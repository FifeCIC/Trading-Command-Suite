import { Controller, Get, Patch, Post, Delete, Param, Query, Body, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivesService } from './directives.service';
import { DirectiveConfigService } from '../scoring/directive-config.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { DIRECTIVE_GROUPS, SHORT_DIRECTIVE_GROUPS, BTC_SPEED_GROUPS } from './directive-groups';

@ApiTags('directives')
@Controller('directives')
export class DirectivesController {
  private readonly logger = new Logger(DirectivesController.name);

  constructor(
    private readonly directivesService: DirectivesService,
    private readonly configService: DirectiveConfigService,
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all registered directives with metadata' })
  @ApiOkResponse({ description: 'Array of directive definitions' })
  async list() {
    const directives = this.directivesService.list();

    // Load active-status + nature from DB (with deadline to avoid DB-lock stalls)
    const dbStatuses = new Map<string, boolean>();
    const dbNatures = new Map<string, string>();
    try {
      const DB_DEADLINE_MS = 3000;
      const dbResult = await Promise.race([
        this.directivesService.getDbStatuses(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), DB_DEADLINE_MS)),
      ]);
      if (dbResult) {
        for (const d of dbResult) {
          dbStatuses.set(d.id, d.active);
          if (d.nature) dbNatures.set(d.id, d.nature);
        }
      }
    } catch { /* DB might not be available */ }

    // Build directive→category map from canonical group definitions (Epic #510 Phase 4).
    const directiveCategory = new Map<string, string>();
    for (const group of [...DIRECTIVE_GROUPS, ...SHORT_DIRECTIVE_GROUPS, ...BTC_SPEED_GROUPS]) {
      for (const did of group.directiveIds) {
        if (!directiveCategory.has(did)) directiveCategory.set(did, group.name);
      }
    }

    // Fallback category map for directives not assigned to any protocol group
    const FALLBACK_CATEGORIES: Record<string, string> = {
      // Technical Analysis — indicators, patterns, chart-based
      'atr-dip': 'Technical Analysis', 'adx': 'Technical Analysis', 'stochastic': 'Technical Analysis',
      'mfi': 'Technical Analysis', 'momentum-continuation-combo': 'Technical Analysis',
      'price-above-sma': 'Technical Analysis', 'ma-crossover': 'Technical Analysis',
      'moving-averages': 'Technical Analysis', 'bollinger-bands': 'Technical Analysis',
      'bollinger-band-squeeze': 'Technical Analysis', 'cci': 'Technical Analysis',
      'obv': 'Technical Analysis', 'volume-rhythm': 'Technical Analysis', 'vwap': 'Technical Analysis',
      'volume-surge': 'Technical Analysis', 'doji-pattern': 'Technical Analysis',
      'hammer-pattern': 'Technical Analysis', 'engulfing-pattern': 'Technical Analysis',
      'three-soldiers-pattern': 'Technical Analysis', 'pin-bar-pattern': 'Technical Analysis',
      'price-action': 'Technical Analysis', 'support-resistance-levels': 'Technical Analysis',
      'overhead-supply-pressure': 'Technical Analysis', 'resistance-levels-strategy': 'Technical Analysis',
      'volatility-tools': 'Technical Analysis', 'volatility-envelope': 'Technical Analysis',
      'confluence-reversal-combo': 'Technical Analysis', 'macd': 'Technical Analysis',
      'mean-reversion': 'Technical Analysis',
      'mt5-engulfing': 'Technical Analysis', 'mt5-harami': 'Technical Analysis',
      'mt5-star-doji': 'Technical Analysis', 'mt5-hammer': 'Technical Analysis',
      // Market Context — time-based, calendar, regime
      'monday-effect': 'Market Context', 'friday-positioning': 'Market Context',
      'midweek-momentum': 'Market Context', 'advanced-weekly-rhythm': 'Market Context',
      'basic-weekly-rhythm': 'Market Context', 'weekly-rhythm-strategy': 'Market Context',
      'intraday-u-pattern': 'Market Context', 'spy-options-expiry': 'Market Context',
      'spy-month-end-rebalancing': 'Market Context', 'spy-qqq-relative-strength': 'Market Context',
      'market-regime': 'Market Context', 'institutional-timing': 'Market Context',
      // Sentiment & Fundamentals
      'dividend-yield-attractive': 'Sentiment & Fundamentals',
      'nvda-earnings-momentum': 'Sentiment & Fundamentals',
      'tsla-sentiment-amplifier': 'Sentiment & Fundamentals',
      'conviction-growth': 'Sentiment & Fundamentals',
      'like-zacks': 'Sentiment & Fundamentals',
      'earnings-implementation': 'Sentiment & Fundamentals',
      'earnings-whispers': 'Sentiment & Fundamentals',
      'analyst-adjustments': 'Sentiment & Fundamentals',
      // Risk & Structural
      'position-size-kelly': 'Risk & Structural', 'position-size-confidence': 'Risk & Structural',
      'panic-exhaustion-absorption': 'Risk & Structural', 'time-based-support': 'Risk & Structural',
      'isa-reset': 'Risk & Structural',
      'adaptive-risk-monitor': 'Risk & Structural',
      // Exit Signals
      'momentum-exhaustion': 'Exit Signals', 'target-achieved': 'Exit Signals',
      'regime-shift-exit': 'Exit Signals', 'time-stop': 'Exit Signals',
      // Strategy Composites
      'sp500-regime': 'Strategy Composites', 'vix-strategy': 'Strategy Composites',
    };

    for (const [id, cat] of Object.entries(FALLBACK_CATEGORIES)) {
      if (!directiveCategory.has(id)) directiveCategory.set(id, cat);
    }

    // Complexity scoring: based on data sources and computation type
    const complexityMap: Record<string, { level: number; label: string; factors: string[] }> = {};
    for (const d of directives) {
      const factors: string[] = [];
      let level = 1;

      if (d.id.includes('multi') || d.id.includes('combo') || d.id.includes('composite')) { level += 2; factors.push('multi-factor'); }
      if (['atr-dip', 'adx', 'volatility-tools', 'bollinger-band-squeeze', 'volatility-envelope'].includes(d.id)) { level += 1; factors.push('statistical'); }
      if (['earnings-momentum', 'social-buzz', 'insider-activity', 'dilution-impact', 'earnings-proximity'].includes(d.id)) { level += 1; factors.push('external-data'); }
      if (['gold-macro-correlation', 'cad-usd-oil-correlation', 'dxy-regime'].includes(d.id)) { level += 2; factors.push('multi-source'); }
      if (['budget-gate', 'liquidity-check', 'rollover-risk', 'position-size-kelly', 'position-size-confidence'].includes(d.id)) { level += 1; factors.push('risk-calculation'); }
      if (['mt5-engulfing', 'mt5-harami', 'mt5-star-doji', 'mt5-hammer'].includes(d.id)) { level += 1; factors.push('pattern-detection'); }
      if (d.priority && d.priority >= 70) { level += 1; factors.push('high-priority'); }

      const labels = ['Basic', 'Simple', 'Moderate', 'Complex', 'Advanced', 'Expert'];
      complexityMap[d.id] = {
        level: Math.min(level, 6),
        label: labels[Math.min(level - 1, 5)],
        factors,
      };
    }

    // Compute protocolCount from DB (how many distinct protocols include each directive).
    // Falls back to 0 if DB unavailable — this is UI enrichment only.
    const protocolCounts = new Map<string, number>();
    try {
      const entries = await (this.prisma as any).protocolDirectiveEntry.findMany({
        select: { directiveId: true, group: { select: { protocolId: true } } },
      });
      // Count distinct protocols per directive (not groups)
      const directiveProtocols = new Map<string, Set<string>>();
      for (const e of entries) {
        if (!directiveProtocols.has(e.directiveId)) directiveProtocols.set(e.directiveId, new Set());
        directiveProtocols.get(e.directiveId)!.add(e.group.protocolId);
      }
      for (const [dirId, protoSet] of directiveProtocols) {
        protocolCounts.set(dirId, protoSet.size);
      }
    } catch { /* DB unavailable — protocolCounts stays empty */ }

    // ── Merge stats from Score history ──
    // Short deadline — Score queries may be slow/locked. Return directives immediately
    // without stats rather than blocking. Stats are available via GET /api/directives/stats.
    const STATS_DEADLINE_MS = 3000;
    const statsResult = await Promise.race([
      (async () => {
        const recentScores = await this.directivesService.getRecentScores(200).catch(() => []);
        const statMap = new Map<string, { totalScore: number; count: number; bullishCount: number; bearishCount: number; protocols: Set<string> }>();
        for (const s of recentScores) {
          const breakdown = (s as any).breakdown || {};
          for (const [dirId, dirScore] of Object.entries(breakdown)) {
            if (!statMap.has(dirId)) {
              statMap.set(dirId, { totalScore: 0, count: 0, bullishCount: 0, bearishCount: 0, protocols: new Set() });
            }
            const st = statMap.get(dirId)!;
            st.totalScore += dirScore as number;
            st.count++;
            if ((dirScore as number) >= 50) st.bullishCount++;
            else if ((dirScore as number) < 30) st.bearishCount++;
            if ((s as any).strategyId) st.protocols.add((s as any).strategyId);
          }
        }

        // ── Fallback: if no recent scores found, query total run counts ──
        if (recentScores.length === 0) {
          const runCounts = await this.directivesService.getDirectiveRunCounts().catch(() => new Map());
          for (const [dirId, count] of runCounts) {
            if (!statMap.has(dirId)) {
              statMap.set(dirId, { totalScore: 0, count: 0, bullishCount: 0, bearishCount: 0, protocols: new Set() });
            }
            statMap.get(dirId)!.count += count;
          }
        }
        return statMap;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATS_DEADLINE_MS)),
    ]);

    const statMap = statsResult ?? new Map<string, { totalScore: number; count: number; bullishCount: number; bearishCount: number; protocols: Set<string> }>();

    // Known stub directive IDs — placeholders awaiting real implementation
    const STUB_IDS = new Set([
      'moving-averages', 'volatility-tools', 'friday-positioning', 'midweek-momentum',
      'advanced-weekly-rhythm', 'spy-options-expiry', 'spy-month-end-rebalancing',
      'spy-qqq-relative-strength', 'nvda-earnings-momentum', 'tsla-sentiment-amplifier',
      'dividend-yield-attractive', 'time-based-support', 'isa-reset',
      'basic-weekly-rhythm', 'intraday-u-pattern', 'institutional-timing', 'macd',
      'adaptive-risk-monitor', 'analyst-adjustments', 'conviction-growth',
      'earnings-implementation', 'earnings-whispers', 'like-zacks', 'mean-reversion',
      'resistance-levels-strategy', 'sp500-regime', 'vix-strategy', 'weekly-rhythm-strategy',
    ]);

    // ── Directive Nature Classification (#289) ──
    // Default nature map — used as fallback when DB has no value.
    // The DB `nature` column takes precedence if set.
    const DEFAULT_NATURE: Record<string, string> = {
      // Predictive — expected to generate directional signals
      'rsi-oversold': 'predictive', 'macd-crossover': 'predictive', 'ema-structure': 'predictive',
      'atr-dip': 'predictive', 'volume-confirmation': 'predictive', 'mfi': 'predictive',
      'adx': 'predictive', 'stochastic': 'predictive', 'rsi-overbought': 'predictive',
      'momentum-continuation-combo': 'predictive', 'speed-momentum': 'predictive',
      'multi-timeframe-trend': 'predictive', 'micro-sr-levels': 'predictive',
      'price-above-sma': 'predictive', 'ma-crossover': 'predictive', 'bollinger-bands': 'predictive',
      'cci': 'predictive', 'bollinger-band-squeeze': 'predictive', 'obv': 'predictive',
      'volume-rhythm': 'predictive', 'vwap': 'predictive', 'volume-surge': 'predictive',
      'rsi-divergence': 'predictive', 'macd-divergence': 'predictive', 'obv-divergence': 'predictive',
      'vwap-confluence-simple': 'predictive', 'vwap-confluence-bands': 'predictive',
      'mtf-confluence-conservative': 'predictive', 'mtf-confluence-weighted': 'predictive',
      'gap-scanner': 'predictive', 'doji-pattern': 'predictive', 'hammer-pattern': 'predictive',
      'engulfing-pattern': 'predictive', 'three-soldiers-pattern': 'predictive',
      'pin-bar-pattern': 'predictive', 'price-action': 'predictive',
      'confluence-reversal-combo': 'predictive', 'support-resistance-levels': 'predictive',
      'overhead-supply-pressure': 'predictive', 'volatility-envelope': 'predictive',
      'wick-filter': 'predictive', 'zigzag-swing-detector': 'predictive',
      'fibonacci-levels': 'predictive',
      // MT5 ported
      'mt5-engulfing': 'predictive', 'mt5-harami': 'predictive', 'mt5-star-doji': 'predictive',
      'mt5-hammer': 'predictive', 'williams-r': 'predictive', 'awesome-oscillator': 'predictive',
      'force-index': 'predictive', 'chaikin-money-flow': 'predictive', 'donchian-breakout': 'predictive',
      'keltner-channel': 'predictive', 'supertrend': 'predictive', 'parabolic-sar': 'predictive',
      'adx-di-crossover': 'predictive', 'bollinger-pct-b': 'predictive', 'atr-trailing-stop': 'predictive',
      'momentum-roc': 'predictive', 'demarker': 'predictive', 'accumulation-dist': 'predictive',
      'bulls-power': 'predictive', 'bears-power': 'predictive', 'ease-of-movement': 'predictive',
      'ichimoku-cloud': 'predictive',
      // Risk gates — block/reduce, don't generate bullish signals
      'budget-gate': 'risk-gate', 'liquidity-check': 'risk-gate', 'rollover-risk': 'risk-gate',
      'position-size-kelly': 'risk-gate', 'position-size-confidence': 'risk-gate',
      'panic-exhaustion-absorption': 'risk-gate', 'dilution-impact': 'risk-gate',
      // Exit signals — fire when it's time to exit, not entry
      'momentum-exhaustion': 'exit', 'target-achieved': 'exit', 'regime-shift-exit': 'exit',
      'time-stop': 'exit',
      // Calendar / temporal — time-based, not price-based
      'monday-effect': 'calendar', 'friday-drift': 'calendar', 'turnaround-tuesday': 'calendar',
      'session-open-effect': 'calendar', 'santa-claus-rally': 'calendar',
      'january-effect': 'calendar', 'sell-in-may': 'calendar', 'september-slump': 'calendar',
      'october-relief': 'calendar', 'opex-gamma': 'calendar', 'triple-witching': 'calendar',
      'election-cycle': 'calendar', 'crypto-weekend-effect': 'calendar',
      // Macro regime — describe market conditions, not tradable signals
      'dxy-regime': 'regime', 'market-regime': 'regime',
      // Symbol-specific — designed for one symbol, won't fire on SPY
      'gold-macro-correlation': 'symbol-specific', 'cad-usd-oil-correlation': 'symbol-specific',
      'btc-halving-cycle': 'symbol-specific', 'crypto-fear-greed': 'symbol-specific',
      // Data-gated — require external data that may not be present
      'earnings-proximity': 'data-gated',
      'earnings-momentum': 'data-gated', 'social-buzz': 'data-gated',
      'insider-activity': 'data-gated',
    };

    return directives.map((d) => {
      const st = statMap.get(d.id);
      const isStub = STUB_IDS.has(d.id);
      const dbActive = dbStatuses.has(d.id) ? dbStatuses.get(d.id) : true;
      return {
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      category: directiveCategory.get(d.id) ?? 'Other',
      priority: d.priority ?? 50,
      protocolCount: protocolCounts.get(d.id) ?? 0,
      complexity: complexityMap[d.id] ?? { level: 1, label: 'Basic', factors: [] },
      active: dbActive,
      // ── Readiness tier — from directive implementation, default alpha ──
      readiness: (d as any).readiness || 'alpha',
      requiredDataFeeds: (d as any).requiredDataFeeds || [],
      // ── Performance classification (from #283 audit + DB stubbing #288) ──
      //
      // ⚠️ `readiness` IS AUTHORITATIVE (#768). `STUB_IDS` is a HARDCODED snapshot
      // from the #283/#288 audits, and it went stale: eight of its entries were
      // later reimplemented and promoted to `readiness: 'ready'` during the #641
      // cleanup, but remained in the set. That produced internally contradictory
      // API output — `readiness: 'ready'` beside `classification: 'stub'` and
      // `performance: 'underperforming'` — for directives carrying real weight:
      //
      //   volatility-tools           25 protocols
      //   analyst-adjustments        19 protocols
      //   moving-averages             4 protocols
      //   spy-qqq-relative-strength   4 protocols
      //   macd                        3 protocols
      //   conviction-growth, mean-reversion, sp500-regime   2 each
      //
      // A consumer reading `classification` would conclude these are placeholders
      // while the scoring engine is running them as production directives. Two
      // fields disagreeing about the same thing is the "one of them is lying"
      // class from #768, and the honest resolution is that the DIRECTIVE CLASS
      // knows its own maturity — a hardcoded list cannot.
      //
      // So the stub label now only applies where readiness does NOT say ready.
      // Kept (rather than deleting STUB_IDS) because the ids that are genuinely
      // still alpha/beta still need the label, and deleting the set would silently
      // reclassify them as active.
      classification: (!dbActive || (isStub && (d as any).readiness !== 'ready')) ? 'stub' : (st?.count ? 'active' : 'untested'),
      performance: (!dbActive || (isStub && (d as any).readiness !== 'ready')) ? 'underperforming' : (st?.count ? (st.totalScore / st.count >= 50 ? 'healthy' : 'weak') : 'unknown'),
      // ── Directive nature (#289) — DB value first, fallback to defaults ──
      nature: dbNatures.get(d.id) || DEFAULT_NATURE[d.id] || 'predictive',
      // ── Merged stats ──
      avgScore: st?.count ? Math.round(st.totalScore / st.count) : null,
      runs: st?.count ?? null,
      bias: st ? (st.bullishCount > st.bearishCount ? 'bullish' : st.bearishCount > st.bullishCount ? 'bearish' : 'neutral') : null,
      directionBias: (d as any).directionBias || 'neutral',
    };
    });
  }

  /**
   * GET /api/directives/:id/viewer
   *
   * One-shot payload for the Directive Viewer page: directive detail,
   * recent per-directive scores (extracted from Score.breakdown.breakouts),
   * and the protocols that include this directive.
   */
  @Get(':id/viewer')
  async getDirectiveViewer(@Param('id') id: string) {
    const directive = this.directivesService.get(id);
    if (!directive) return { error: `Directive "${id}" not found` };

    // DB metadata (active / nature / readiness)
    let dbMeta: any = {};
    try {
      const dbResult = await this.directivesService.getDbStatuses();
      const dbRow = dbResult?.find((d: any) => d.id === id);
      if (dbRow) dbMeta = { active: dbRow.active, nature: dbRow.nature, readiness: dbRow.readiness };
    } catch { /* DB unavailable */ }

    // Recent per-directive scores from the canonical Score table.
    let scores: any[] = [];
    try {
      const rows = await Promise.race([
        this.prisma.score.findMany({
          where: { timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          orderBy: { timestamp: 'desc' },
          take: 500,
          select: {
            value: true,
            strategyId: true,
            timestamp: true,
            breakdown: true,
            symbol: { select: { ticker: true } },
          },
        }),
        new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Score query timed out')), 3000)),
      ]);
      for (const row of rows) {
        const breakouts = (row as any).breakdown?.breakouts;
        if (!breakouts || typeof breakouts !== 'object') continue;
        for (const entries of Object.values(breakouts)) {
          if (!Array.isArray(entries)) continue;
          for (const e of entries as any[]) {
            if (e?.directiveId !== id) continue;
            scores.push({
              symbol: (row as any).symbol?.ticker ?? null,
              protocol: (row as any).strategyId ?? null,
              score: e.score,
              maxScore: e.maxScore,
              normalized: e.normalizedScore ?? null,
              reason: e.reason ?? null,
              signal: (row as any).breakdown?.signal ?? null,
              composite: (row as any).value ?? null,
              timestamp: (row as any).timestamp,
            });
          }
        }
      }
      scores.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (err) {
      this.logger.warn(`Directive viewer score query failed for ${id}: ${(err as Error).message}`);
    }

    // Protocols that include this directive (deduped by slug).
    let protocols: any[] = [];
    try {
      const entries = await this.prisma.protocolDirectiveEntry.findMany({
        where: { directiveId: id },
        select: {
          maxScore: true,
          active: true,
          group: {
            select: {
              groupId: true,
              weight: true,
              isRiskGate: true,
              protocol: { select: { slug: true, name: true, directionMode: true, active: true } },
            },
          },
        },
      });
      const protoMap = new Map<string, any>();
      for (const e of entries) {
        const p = (e as any).group?.protocol;
        if (!p) continue;
        if (!protoMap.has(p.slug)) {
          protoMap.set(p.slug, {
            slug: p.slug,
            name: p.name,
            directionMode: p.directionMode,
            active: p.active,
            groups: [],
          });
        }
        protoMap.get(p.slug).groups.push({
          groupId: (e as any).group.groupId,
          weight: (e as any).group.weight,
          isRiskGate: (e as any).group.isRiskGate,
          maxScore: (e as any).maxScore,
          active: (e as any).active,
        });
      }
      protocols = Array.from(protoMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      this.logger.warn(`Directive viewer protocol query failed for ${id}: ${(err as Error).message}`);
    }

    return {
      id: directive.id,
      name: directive.name,
      description: directive.description ?? '',
      category: (directive as any).category || 'Other',
      maxScore: directive.maxScore ?? null,
      priority: directive.priority ?? null,
      version: directive.version,
      active: dbMeta.active ?? true,
      readiness: dbMeta.readiness || (directive as any).readiness || 'alpha',
      nature: dbMeta.nature,
      directionBias: (directive as any).directionBias ?? 'neutral',
      complexity: (directive as any).complexity,
      requiredDataFeeds: (directive as any).requiredDataFeeds ?? [],
      formula: (directive as any).formula,
      inputs: (directive as any).inputs,
      dependsOn: (directive as any).dependsOn,
      protocolCount: protocols.length,
      scoreCount: scores.length,
      scores,
      protocols,
    };
  }

  /**
   * GET /api/directives/stats
   *
   * Returns per-directive performance stats from Score history.
   * Computes: average score, directional bias, top protocols, recent activity.
   */
  @Get('stats')
  async getStats() {
    // Get recent scores with breakdown data
    const scores = await this.directivesService.getRecentScores(200).catch(() => []);
    const directives = this.directivesService.list();

    // Build per-directive stats
    const statMap = new Map<string, {
      totalScore: number;
      count: number;
      bullishCount: number;
      bearishCount: number;
      protocols: Set<string>;
    }>();

    for (const s of scores) {
      const breakdown = (s as any).breakdown || {};
      for (const [dirId, dirScore] of Object.entries(breakdown)) {
        if (!statMap.has(dirId)) {
          statMap.set(dirId, { totalScore: 0, count: 0, bullishCount: 0, bearishCount: 0, protocols: new Set() });
        }
        const st = statMap.get(dirId)!;
        st.totalScore += dirScore as number;
        st.count++;
        if ((dirScore as number) >= 50) st.bullishCount++;
        else if ((dirScore as number) < 30) st.bearishCount++;
        if ((s as any).strategyId) st.protocols.add((s as any).strategyId);
      }
    }

    const stats = directives.map(d => {
      const st = statMap.get(d.id);
      if (!st) return {
        id: d.id, name: d.name,
        avgScore: null, count: 0,
        directionalBias: 'no-data',
        biasPct: 0,
        protocolCount: 0,
      };
      return {
        id: d.id,
        name: d.name,
        avgScore: Math.round(st.totalScore / st.count),
        count: st.count,
        directionalBias: st.bullishCount > st.bearishCount ? 'bullish' : st.bearishCount > st.bullishCount ? 'bearish' : 'neutral',
        biasPct: st.count > 0 ? Math.round((Math.max(st.bullishCount, st.bearishCount) / st.count) * 100) : 0,
        protocolCount: st.protocols.size,
      };
    }).sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

    return { generatedAt: new Date().toISOString(), stats, total: stats.length };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Toggle a directive active/inactive and set nature' })
  async toggleDirective(
    @Param('id') id: string,
    @Body() body: { active: boolean; nature?: string },
  ) {
    // Find or create DB Directive row, then toggle
    const directive = await this.directivesService.upsertDirective(id, body.active, body.nature);
    return { id, active: body.active, nature: body.nature, persisted: true };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━
  //  Fork endpoints (Q301b)
  // ━━━━━━━━━━━━━━━━━━━━━━━━

  @Get('forks')
  @ApiOperation({ summary: 'List all directive forks' })
  async listForks() {
    const forks = await this.directivesService.getForks();
    return { forks };
  }

  @Post('seed')
  @ApiOperation({ summary: 'Seed all in-memory directives into the database (Epic #510 Phase 1)' })
  async seedToDatabase() {
    return this.directivesService.seedToDatabase();
  }

  @Get('effective')
  @ApiOperation({ summary: 'Get effective directive for a strategy (fork or original)' })
  async getEffective(
    @Query('directiveId') directiveId: string,
    @Query('strategyId') strategyId: string,
  ) {
    const directive = await this.directivesService.getEffectiveDirective(
      directiveId,
      strategyId,
    );
    return { directive };
  }

  @Post(':id/fork')
  @ApiOperation({ summary: 'Create a fork of a directive for a strategy' })
  async fork(
    @Param('id') id: string,
    @Body() body: { strategyId: string; weight?: number; config?: any; reason?: string },
  ) {
    const fork = await this.directivesService.forkDirective(
      id,
      body.strategyId,
      { weight: body.weight, config: body.config, reason: body.reason },
    );
    return { fork };
  }

  @Delete(':id/revert')
  @ApiOperation({ summary: 'Revert a fork — delete it and fall back to parent' })
  async revert(@Param('id') id: string) {
    const result = await this.directivesService.revertFork(id);
    return result;
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test a single directive against live/historical bars for a symbol' })
  async testDirective(
    @Param('id') id: string,
    @Body() body: { symbol: string; timeframe?: string; barCount?: number },
  ) {
    const { symbol, timeframe = '1d', barCount = 100 } = body;
    if (!symbol) return { error: 'symbol is required' };

    // Look up symbol in DB to get DB id for bar fetch
    const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: symbol.toUpperCase() } }).catch(() => null);
    if (!dbSym) return { error: `Symbol "${symbol}" not found in database` };

    // Fetch bars
    const bars = await this.marketData.getBars(dbSym.id, timeframe, barCount).catch(() => null);
    if (!bars || bars.length === 0) return { error: `No ${timeframe} bars available for ${symbol}` };

    // Run the single directive
    const result = await this.directivesService.runSingle(id, { symbol: symbol.toUpperCase(), bars });
    if (!result) return { error: `Directive "${id}" not found or failed to execute` };

    return {
      directiveId: id,
      symbol: symbol.toUpperCase(),
      timeframe,
      barCount: bars.length,
      firstBar: bars[0]?.timestamp?.toISOString?.() ?? bars[0]?.timestamp,
      lastBar: bars[bars.length - 1]?.timestamp?.toISOString?.() ?? bars[bars.length - 1]?.timestamp,
      bars: bars.map((b) => ({
        time: Math.floor(new Date(b.timestamp).getTime() / 1000),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      result,
    };
  }

  /**
   * POST /api/directives/:id/stub — mark a directive as alpha (inactive in composites).
   * Used by the Directive Performance Audit to instantly suppress underperforming directives.
   */
  @Post(':id/stub')
  async stubDirective(@Param('id') id: string) {
    const directive = this.directivesService.get(id);
    if (!directive) return { error: `Directive "${id}" not found` };

    // Update in-memory readiness
    (directive as any).readiness = 'alpha';

    // Persist to DB if available (raw SQL — directive table has many required fields)
    if (this.prisma.isAvailable) {
      try {
        await (this.prisma as any).$executeRawUnsafe(
          `INSERT INTO directive (id, name, type, weight, active, readiness) VALUES (?, ?, 'scoring', 1.0, 0, 'alpha') ON DUPLICATE KEY UPDATE active = 0, readiness = 'alpha'`,
          id, directive.name || id,
        );
      } catch (err) {
        return { stubbed: true, warning: `In-memory only — DB persist failed: ${(err as Error).message}` };
      }
    }

    return { stubbed: true, directiveId: id, readiness: 'alpha', note: 'Directive excluded from composites. Use reload-config or restart to apply globally.' };
  }

  // ── Directive Config (DB-backed, user-adjustable) ────

  @Get('config')
  @ApiOperation({ summary: 'Get all directive config overrides from DB' })
  async getAllConfig() {
    const configs = await this.configService.getAllConfigs();
    const result: Record<string, any> = {};
    for (const [id, config] of configs) {
      result[id] = config;
    }
    return result;
  }

  /**
   * ⚠️ DECLARED BELOW the literal GET routes (`stats`, `forks`, `effective`, `config`).
   *
   * Express matches in declaration order. This parameterised route was declared near the TOP of
   * the controller, so it captured every one-segment literal path: `GET /api/directives/stats` did
   * not 404 — it ran this handler with id="stats" and returned
   *
   *     {"error":"Directive \"stats\" not found"}
   *
   * — HTTP 200 with a plausible error body, so nothing looked broken. Four routes were affected:
   * `stats`, `forks`, `effective`, `config`. See #856. Guarded by
   * `nest/src/common/route-order.spec.ts`, which fails if any literal route is declared after a
   * parameterised one in the same method.
   *
   * Returns a single directive by ID, directly from the registry + DB.
   */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const directive = this.directivesService.get(id);
    if (!directive) return { error: `Directive "${id}" not found` };

    // Load DB metadata
    let dbMeta: any = {};
    try {
      const dbResult = await this.directivesService.getDbStatuses();
      const dbRow = dbResult?.find((d: any) => d.id === id);
      if (dbRow) dbMeta = { active: dbRow.active, nature: dbRow.nature, readiness: dbRow.readiness };
    } catch {}

    return {
      id: directive.id,
      name: directive.name,
      description: directive.description,
      category: (directive as any).category || 'Other',
      maxScore: directive.maxScore,
      complexity: (directive as any).complexity,
      active: dbMeta.active ?? true,
      classification: (directive as any).classification || 'active',
      nature: dbMeta.nature,
      readiness: dbMeta.readiness || directive.readiness || 'alpha',
      requiredDataFeeds: (directive as any).requiredDataFeeds || [],
      directionBias: directive.directionBias,
      version: directive.version,
      priority: directive.priority,
      performance: dbMeta.performance,
      inputs: (directive as any).inputs,
      dependsOn: (directive as any).dependsOn,
      formula: (directive as any).formula,
    };
  }

  @Get(':id/config')
  @ApiOperation({ summary: 'Get DB config for a single directive' })
  async getConfig(@Param('id') id: string) {
    return this.configService.getConfig(id);
  }

  @Patch(':id/config')
  @ApiOperation({ summary: 'Update DB config for a directive' })
  async updateConfig(@Param('id') id: string, @Body() body: Record<string, any>) {
    await this.configService.updateConfig(id, body);
    return { directiveId: id, updated: Object.keys(body) };
  }
}
