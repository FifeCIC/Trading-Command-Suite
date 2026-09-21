import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Symbol } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { UpdateSymbolDto } from './dto/update-symbol.dto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { resolvePositionPnl } from '../../common/utils/position-pnl';

@Injectable()
export class SymbolsService {
  private readonly logger = new Logger(SymbolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  async create(dto: CreateSymbolDto): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot create symbol in fallback mode.',
      );
    }

    const data: Prisma.SymbolCreateInput = {
      ticker: dto.ticker.toUpperCase(),
      name: dto.name,
      exchange: dto.exchange,
      type: dto.type,
      tags: dto.tags ?? [],
      aliases: dto.aliases ?? {},
      active: true,
    };

    return this.prisma.symbol.create({ data });
  }

  async findAll(search?: string): Promise<Symbol[]> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — returning empty symbol list.');
      return [];
    }

    try {
      const where: Prisma.SymbolWhereInput = {};
      if (search && search.trim().length > 0) {
        where.OR = [
          { ticker: { contains: search.trim() } },
          { name: { contains: search.trim() } },
        ];
      }
      return await this.prisma.symbol.findMany({
        where,
        orderBy: [{ ticker: 'asc' }],
        take: search ? 10 : undefined,
      });
    } catch (error) {
      this.logger.warn(
        `Database unavailable while listing symbols: ${String(error)}`,
      );
      return [];
    }
  }

  /** Find symbols that have a specific tag in their JSON tags array. */
  async findByTag(tag: string): Promise<Symbol[]> {
    if (!this.prisma.isAvailable) return [];

    // MySQL JSON_CONTAINS: check if tags array contains the given tag string
    const symbols = await this.prisma.$queryRawUnsafe<Symbol[]>(
      `SELECT * FROM Symbol WHERE JSON_CONTAINS(tags, ?) ORDER BY ticker ASC`,
      JSON.stringify(tag),
    );
    return symbols;
  }

  async findOne(id: string): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot retrieve symbol in fallback mode.',
      );
    }

    const symbol = await this.prisma.symbol.findUnique({ where: { id } });
    if (!symbol) {
      throw new NotFoundException(`Symbol ${id} not found`);
    }

    return symbol;
  }

  async update(id: string, dto: UpdateSymbolDto): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot update symbol in fallback mode.',
      );
    }

    await this.findOne(id);

    const data: Prisma.SymbolUpdateInput = {
      ...(dto.ticker ? { ticker: dto.ticker.toUpperCase() } : {}),
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.exchange ? { exchange: dto.exchange } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      ...(dto.aliases !== undefined ? { aliases: dto.aliases } : {}),
    };

    return this.prisma.symbol.update({
      where: { id },
      data,
    });
  }

  async setActive(id: string, active: boolean): Promise<Symbol> {
    if (!this.prisma.isAvailable) {
      throw new Error(
        'Database is not available. Cannot update symbol in fallback mode.',
      );
    }

    await this.findOne(id);

    return this.prisma.symbol.update({
      where: { id },
      data: { active },
    });
  }

  async getOverview(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    // Find symbol
    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // Latest quote (if available)
    let price = null;
    try {
      const marketBar = await (this.prisma as any).marketBar.findFirst({
        where: { symbolId: symbol.id },
        orderBy: { timestamp: 'desc' },
      });
      if (marketBar) {
        price = {
          last: Number(marketBar.close),
          change: 0,
          changePct: 0,
          provider: 'finnhub',
          timestamp: marketBar.timestamp?.toISOString() || null,
        };
      }
    } catch { /* no market data */ }

    // Positions
    let positions: any[] = [];
    try {
      const allPositions = await (this.prisma as any).position.findMany();
      // 2026-09-10 — Position has no `symbolTicker` column (that filter could
      // never match), so match on symbolId or the symbol text.
      positions = allPositions.filter((p: any) =>
        p.symbolId === symbol.id || String(p.symbol ?? '').toUpperCase() === upperTicker
      );
    } catch { /* no positions */ }

    // Freshness
    const freshness = {
      status: price ? 'fresh' : 'stale',
      lastBar: price?.timestamp || null,
      timeframe: '1h',
    };

    return {
      symbol: {
        id: symbol.id,
        ticker: symbol.ticker,
        name: symbol.name,
        exchange: symbol.exchange,
        type: symbol.type,
      },
      price,
      starred: symbol.active,
      positions: positions.map((p) => {
        // 2026-09-10 — the Position column is `pnl`; the old `unrealizedPnl` read
        // did not exist on this model, so every row reported 0.
        const { pnl } = resolvePositionPnl({
          side: p.side,
          avgPrice: p.avgPrice,
          currentPrice: p.currentPrice,
          quantity: p.quantity,
          brokerPnl: p.pnl,
        });
        return {
          provider: p.provider || 'unknown',
          accountId: p.accountId || 'default',
          quantity: p.quantity,
          avgPrice: Number(p.avgPrice || 0),
          pnl: pnl ?? 0,
          side: p.side ?? null,
        };
      }),
      freshness,
    };
  }

  /**
   * Current-holdings map from the stored Position table (DB-only — no external
   * provider calls, so it is safe for page render). Every stored Position row is a
   * current open position/holding; keyed for cross-referencing the Symbols Browser
   * (match by uppercased ticker).
   */
  async getPositionMap() {
    if (!this.prisma.isAvailable) return [];
    try {
      const rows = await this.prisma.position.findMany({
        orderBy: { symbol: 'asc' },
      });
      return rows.map((p) => {
        // 2026-09-10 — side-aware. This endpoint reported `pnl: +56.13` beside
        // `pnlPct: -1.70%` for a short XAUUSD position because the percentage was
        // computed long-only while the stored amount came from the broker.
        const { pnl, pnlPct } = resolvePositionPnl({
          side: p.side,
          avgPrice: p.avgPrice,
          currentPrice: p.currentPrice,
          quantity: p.quantity,
          brokerPnl: p.pnl,
        });
        return {
          symbol: p.symbol,
          hasPosition: true,
          quantity: p.quantity,
          avgPrice: p.avgPrice,
          currentPrice: p.currentPrice,
          pnl,
          pnlPct,
          side: p.side ?? null,
          provider: p.provider,
        };
      });
    } catch (error) {
      this.logger.warn(`Could not load positions for symbols browser: ${String(error)}`);
      return [];
    }
  }

  /**
   * Single-symbol snapshot for the Symbols Browser detail rail — company basics,
   * best-effort provider profile (sector/industry/market cap), and day + historical
   * high/low derived from stored daily bars. Never blocks on the external provider
   * (profile fetch is best-effort and null-safe).
   */
  async getSnapshot(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // Best-effort company profile (sector / industry / market cap)
    let sector: string | null = null;
    let industry: string | null = null;
    let marketCap: number | null = null;
    try {
      const adapter = this.adapterFactory.create('finnhub') as any;
      if (adapter && typeof adapter.getProfile === 'function') {
        const profile = await adapter.getProfile(upperTicker);
        sector = profile?.sector ?? null;
        industry = profile?.industry ?? null;
        if (profile?.marketCap) marketCap = Number(profile.marketCap);
      }
    } catch { /* profile unavailable — leave null */ }

    try {
      const metric = await this.prisma.companyMetric.findUnique({
        where: { symbol: upperTicker },
      });
      if (metric?.marketCap) marketCap = Number(metric.marketCap);
    } catch { /* no company metric */ }

    // Day + historical ranges from stored daily bars
    let price: number | null = null;
    let dayHigh: number | null = null;
    let dayLow: number | null = null;
    let historicalHigh: number | null = null;
    let historicalLow: number | null = null;
    try {
      const bars = await (this.prisma as any).marketBar.findMany({
        where: { symbolId: symbol.id, timeframe: '1d' },
        orderBy: { timestamp: 'asc' },
      }) as { high: number; low: number; close: number }[];
      if (bars.length > 0) {
        historicalHigh = Math.max(...bars.map((b) => Number(b.high)));
        historicalLow = Math.min(...bars.map((b) => Number(b.low)));
        const latest = bars[bars.length - 1];
        dayHigh = Number(latest.high);
        dayLow = Number(latest.low);
        price = Number(latest.close);
      }
    } catch { /* no bars */ }

    return {
      symbol: {
        id: symbol.id,
        ticker: symbol.ticker,
        name: symbol.name,
        exchange: symbol.exchange,
        type: symbol.type,
        active: symbol.active,
      },
      company: {
        name: symbol.name,
        exchange: symbol.exchange,
        type: symbol.type,
        sector,
        industry,
        marketCap,
      },
      price,
      ranges: { dayHigh, dayLow, historicalHigh, historicalLow },
    };
  }

  async getProtocols(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // Find strategies that include this symbol
    let strategies: any[] = [];
    try {
      const all = await (this.prisma as any).strategy.findMany({
        include: { scores: true },
      });
      strategies = all.filter((s: any) => {
        const config = (s.config as any) || {};
        const symbols = config.symbols || config.symbolFocus || [];
        return symbols.includes(upperTicker) || symbols.includes(symbol.id);
      });
    } catch {
      strategies = [];
    }

    const protocols = strategies.map((s) => {
      const scores = (s.scores || []).map((sc: any) => Number(sc.score || 0)).reverse();
      const currentScore = scores[scores.length - 1] || 0;
      const firstSpark = scores[0] || currentScore;
      const trend = currentScore > firstSpark ? 'rising' : currentScore < firstSpark ? 'falling' : 'flat';

      let signal = 'watch';
      if (currentScore >= 70) signal = 'entry';
      else if (currentScore <= 30) signal = 'exit';

      return {
        id: s.id,
        name: s.name || 'Untitled',
        type: (s.config as any)?.hasRiskConfig ? 'trading-strategy' : 'protocol',
        intendedTimeframe: (s.config as any)?.timeframe || '1H',
        score: currentScore,
        signal,
        exitUrgency: currentScore <= 30 ? 'high' : currentScore <= 50 ? 'medium' : 'low',
        confidence: Math.min(0.95, currentScore / 100 + 0.1),
        lastRun: s.updatedAt?.toISOString() || null,
        trend,
        sparkline: scores,
      };
    });

    return { symbol: upperTicker, protocols, count: protocols.length };
  }

  /**
   * Single-symbol focus view — aggregates everything for one ticker:
   * protocols, scoring strategies, trading strategies, live decisions, trade outcomes.
   */
  async getFocus(ticker: string) {
    const upperTicker = ticker.toUpperCase();
    const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: upperTicker } });
    if (!dbSymbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    // ── Helper: read watchlist JSON ──
    const WATCHLISTS_DIR = resolve(__dirname, '../../../../src/data/watchlists');
    const readWatchlist = (name: string): string[] | null => {
      try {
        const path = resolve(WATCHLISTS_DIR, `${name}.json`);
        if (!existsSync(path)) return null;
        const raw = readFileSync(path, 'utf-8');
        const data = JSON.parse(raw);
        return Array.isArray(data)
          ? data.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean)
          : null;
      } catch { return null; }
    };

    // ── 1. Scoring Strategies that include this symbol ──
    const allScoring = await (this.prisma as any).scoringStrategy.findMany({
      where: { enabled: true },
    }) as any[];

    const scoringForSymbol = allScoring.filter((s: any) => {
      const wl = readWatchlist(s.watchlistName);
      return wl && wl.map((x: string) => x.toUpperCase()).includes(upperTicker);
    });

    // ── 2. Trading Strategies that target this symbol ──
    const tradingStrategies = await (this.prisma as any).tradingStrategy.findMany({
      where: { symbol: upperTicker, active: true },
    }) as any[];

    // ── 3. Recent decisions from decision_log ──
    const recentDecisions = await (this.prisma as any).decisionLog.findMany({
      where: { symbol: upperTicker },
      orderBy: { timestamp: 'desc' },
      take: 20,
    }) as any[];

    // ── 4. Recent strategy evaluations ──
    const recentEvaluations = await (this.prisma as any).strategyEvaluation.findMany({
      where: { symbol: upperTicker },
      orderBy: { evaluatedAt: 'desc' },
      take: 20,
    }) as any[];

    const protocolIds = new Set<string>();
    scoringForSymbol.forEach((s: any) => { protocolIds.add(s.protocolId); if (s.shortProtocolId) protocolIds.add(s.shortProtocolId); });
    tradingStrategies.forEach((s: any) => { protocolIds.add(s.protocolId); if (s.shortProtocolId) protocolIds.add(s.shortProtocolId); });

    // Protocol info — query from DB (Epic #510 Phase 4, replaces PROTOCOL_REGISTRY import)
    const dbProtocols = await (this.prisma as any).protocol.findMany({
      where: { slug: { in: [...protocolIds] } },
      select: { slug: true, name: true, description: true, directionMode: true, tradingStyle: true, idealFor: true, directiveGroups: { select: { id: true } } },
    }).catch(() => []);
    const protocolMap: Record<string, any> = {};
    for (const p of dbProtocols) {
      protocolMap[p.slug] = p;
    }

    const protocolInfo: Record<string, any> = {};
    for (const pid of protocolIds) {
      const entry = protocolMap[pid];
      if (entry) {
        protocolInfo[pid] = {
          id: pid,
          name: entry.name || pid,
          description: entry.description || '',
          directionMode: entry.directionMode || 'LONG_ONLY',
          tradingStyle: entry.tradingStyle || '',
          groupCount: entry.directiveGroups?.length || 0,
          idealFor: entry.idealFor || '',
        };
      }
    }

    // ── 6. Build response ──
    return {
      ticker: upperTicker,
      name: dbSymbol.name,
      exchange: dbSymbol.exchange,
      type: dbSymbol.type,
      active: dbSymbol.active,
      protocols: protocolInfo,
      scoringStrategies: scoringForSymbol.map((s: any) => ({
        id: s.id,
        name: s.name,
        protocolId: s.protocolId,
        shortProtocolId: s.shortProtocolId,
        watchlistName: s.watchlistName,
        brokerId: s.brokerId,
        mode: s.mode,
        tradeThreshold: s.tradeThreshold,
        enabled: s.enabled,
        tradingEnabled: s.tradingEnabled,
      })),
      tradingStrategies: tradingStrategies.map((s: any) => ({
        id: s.id,
        name: s.name,
        protocolId: s.protocolId,
        shortProtocolId: s.shortProtocolId,
        brokerId: s.brokerId,
        timeframe: s.timeframe,
        minComposite: s.minComposite,
        slPct: s.slPct,
        tpPct: s.tpPct,
        mode: s.mode,
        active: s.active,
        baseSize: s.baseSize,
      })),
      recentDecisions: recentDecisions.map((d: any) => ({
        timestamp: d.timestamp,
        tickNumber: d.tickNumber,
        strategyId: d.strategyId,
        decision: d.decision,
        reason: d.reason,
        // #909 — unit-explicit scores; `compositeLegacy` is the pre-split value (unit unrecorded).
        compositeRaw: d.compositeRaw ?? null,
        compositePct: d.compositePct ?? null,
        compositeLegacy: d.composite ?? null,
        signal: d.signal,
        ticket: d.ticket,
        price: d.price,
        quantity: d.quantity,
      })),
      recentEvaluations: recentEvaluations.map((e: any) => ({
        id: e.id,
        strategyId: e.strategyId,
        composite: e.composite,
        signal: e.signal,
        rarityBand: e.rarityBand,
        rarityPct: e.rarityPct,
        traded: e.traded,
        tradeTicket: e.tradeTicket,
        tradeResult: e.tradeResult,
        evaluatedAt: e.evaluatedAt,
      })),
      scored: scoringForSymbol.length > 0 || tradingStrategies.length > 0,
    };
  }
}
