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
// #854/#778 — the ONE definition of a broker-maintained ("live") position row.
import { isLivePosition } from '../../common/utils/position-freshness';

/** A symbol's data-source record — one provider that has delivered bars for it. */
export interface SymbolSource {
  provider: string;
  bars: number;
  lastBarAt: string | null;
}

/** `symbolId` → every provider that has delivered bars for it. */
type SourceMap = Map<string, SymbolSource[]>;

@Injectable()
export class SymbolsService {
  private readonly logger = new Logger(SymbolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Data-source map cache — `symbolId` → the providers that delivered bars.
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ WHY THIS IS CACHED RATHER THAN OPTIMISED — every number measured 2026-09-23.
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * The map is **114 rows** derived from **601,239** `marketbar` rows (83MB data + 74MB index).
   * Every formulation of the aggregation costs about five seconds:
   *
   *     GROUP BY symbolId, provider .......... 4,606ms
   *     bounded to the last 7 days .......... 8,150ms   SLOWER, and loses 66 of 110 symbols
   *     bounded to the last 2 days .......... 4,972ms   SLOWER, and loses more
   *     DISTINCT (symbolId, provider) ....... 5,203ms
   *     + an index on (symbolId, provider) .. 5,356ms   built in 47.8s; EXPLAIN reports key=NULL
   *
   * So the query is not the thing to fix — **querying it per request is.** Adding this lookup
   * took `/api/symbols` from instant to 4.7–7.0s, which the API flagged itself:
   * `WARN [SlowRequest] GET /api/symbols — 5558ms`. An endpoint that answers correctly in seven
   * seconds is still a regression — correctness is not a budget.
   *
   * ⚠️ The data is near-static, which is what makes a cache honest rather than a fudge:
   * **3 symbols** have EVER been delivered by more than one provider. A 10-minute TTL costs
   * essentially nothing in accuracy and removes the cost from every page load.
   *
   * ⚠️ Refreshes are LOGGED so staleness is visible rather than silent — a cache nobody can see
   * is indistinguishable from a wrong answer.
   */
  private sourceCache: { at: number; map: SourceMap } | null = null;

  /** How long a source map is trusted before it is rebuilt. See `sourceCache`. */
  private static readonly SOURCE_TTL_MS = 10 * 60 * 1000;

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
      return await this.withDataSources(
        await this.prisma.symbol.findMany({
          where,
          orderBy: [{ ticker: 'asc' }],
          take: search ? 10 : undefined,
        }),
      );
    } catch (error) {
      // ⚠️⚠️ DO NOT RETURN []. A failed read and an empty table are OPPOSITE CONCLUSIONS, and
      // returning [] here made them identical: HTTP 200, `symbols: []`, and the page rendered
      // "0 symbols total" as though the registry were genuinely empty.
      //
      // Measured 2026-09-23: a schema drift between the database and the generated Prisma client
      // made `symbol.findMany` throw on EVERY call. This catch turned that into a clean, confident
      // empty page — no error, no warning the reader would see, and the defect stayed invisible
      // for as long as nobody counted the rows.
      //
      // ⚠️ The `!isAvailable` early return ABOVE is different and STAYS: fallback mode is a known
      // state that `modeMeta()` reports as `mode: 'fallback'`. This branch is an unexpected
      // failure, so it must reach the client AS one — the page has an `isError` branch (and
      // TCS-SYS-002) waiting for exactly this.
      this.logger.error(
        `Symbol list read FAILED — propagating rather than returning an empty list: ${String(error)}`,
      );
      throw error;
    }
  }

  /**
   * withDataSources() — attach the AUTHORITATIVE provider(s) to each symbol (#959).
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * ⚠️ WHY THIS EXISTS — the `exchange` column was a FABRICATED label
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * The Active Symbols page had one provenance field: `symbol.exchange`. Measured 2026-09-23,
   * **31 of 258 rows (12%) carried a value that could not be true**:
   *   `Xtrend`     29 — an onboarding-seeder DEFAULT (`s.exchange ?? 'Xtrend'`); there is no
   *                     Xtrend exchange and no Xtrend adapter anywhere in this codebase
   *   `MetaQuotes`  1 — the MT5 PLATFORM, declared by hand on GRML
   *   `Unknown`     1 — an adapter fallback (`x || 'Unknown'` appears in five adapters)
   *
   * The owner read the page and asked why a non-existent exchange appeared on most rows. That is
   * the failure mode: a value that LOOKS like an answer is worse than a blank, because nobody
   * checks it. The seeder now writes NULL, and the 31 rows were reconciled.
   *
   * ⚠️ THE COLUMN IS A SOURCE LABEL, NOT AN EXCHANGE. It holds `Yahoo`, `Trading212`, `Binance`
   * from the import paths — those are providers. So rather than repopulate it with something
   * pretend-accurate, the real provenance is served BESIDE it.
   *
   * ⚠️ `marketbar.provider` is the AUTHORITATIVE field — it records what ACTUALLY DELIVERED bars.
   * It is **NOT** `symbol_route.provider`, which is a different table describing what is
   * *configured*. `docs/symbol-data-coverage-audit.md` warns about exactly this confusion:
   * *"Do not assume `symbol_route.provider` is the same quantity — it is a different table."*
   *
   * ⚠️ `[]` AND `null` ARE DIFFERENT AND MUST STAY SO (development-philosophy §7):
   *   `[]`   — no provider has EVER delivered a bar for this symbol. INFORMATION.
   *   `null` — the lookup FAILED. The absence of information.
   *   Collapsing them would state "this symbol has no data source" when the truth is "we could not
   *   find out", which are opposite conclusions that would render identically.
   */
  private async withDataSources<T extends { id: string }>(
    symbols: T[],
  ): Promise<Array<T & { sources: SymbolSource[] | null }>> {
    const decorated = symbols.map((s) => ({ ...s, sources: [] as SymbolSource[] | null }));
    if (symbols.length === 0) return decorated;

    try {
      // ── Cache lookup. See `sourceCache` for why this is cached rather than tuned. ──
      //
      // ⚠️ STALE-WHILE-REVALIDATE. Measured 2026-09-23 the cold aggregation is **7,321ms** and a
      // cache hit is **17ms**. A plain TTL would therefore make one unlucky page load every ten
      // minutes pay seven seconds — a 400x spike, driven purely by WHEN the user arrived. That is
      // the same defect in a milder costume: the endpoint is correct and intermittently unusable.
      //
      // So a stale map is SERVED rather than blocked on: the reader gets the previous answer
      // immediately and the refresh happens behind them. The 7s cost is paid exactly once, by the
      // first request after boot, instead of once per TTL window.
      const now = Date.now();
      const cached = this.sourceCache;
      let byId: SourceMap;

      if (cached) {
        // Serve what we have, always. Only schedule a rebuild once the map goes stale.
        byId = cached.map;
        if (now - cached.at >= SymbolsService.SOURCE_TTL_MS) {
          // Deliberately not awaited — the reader is not made to wait for a 7s aggregation.
          // `.catch` rather than `void` so a failed background refresh is LOGGED, not swallowed:
          // silently keeping a stale map forever would be indistinguishable from a fresh one.
          this.refreshSourceMap(symbols.map((s) => s.id)).catch((err) =>
            this.logger.warn(
              `Background data-source refresh failed; serving the previous map (may be stale): ${String(err)}`,
            ),
          );
        }
      } else {
        // Nothing to serve yet — this is the one request that pays for the aggregation.
        byId = await this.refreshSourceMap(symbols.map((s) => s.id));
      }

      for (const d of decorated) {
        const list = byId.get(d.id);
        // Largest delivery first, so the dominant provider leads. An absent entry stays `[]`,
        // which is INFORMATION: no provider has ever delivered a bar for this symbol.
        if (list) d.sources = [...list].sort((a, b) => b.bars - a.bars);
      }
    } catch (err) {
      // The symbols are still returned — only the provenance is unknown, and it says so.
      this.logger.warn(
        `Data-source lookup failed; symbol list intact but sources set to null (lookup unknown, ` +
          `NOT "no provider"): ${String(err)}`,
      );
      for (const d of decorated) d.sources = null;
    }
    return decorated;
  }

  /**
   * refreshSourceMap() — rebuild and cache the `symbolId` → providers map.
   *
   * ⚠️ A single in-flight refresh is enforced: concurrent callers share one promise rather than
   * each starting their own five-second aggregation. Without this, a page that fires several
   * requests at once would stampede the database with identical 600k-row scans — the classic
   * cache-miss pile-up, and the failure mode that makes a cache slower than no cache.
   */
  private refreshInFlight: Promise<SourceMap> | null = null;

  private async refreshSourceMap(symbolIds: string[]): Promise<SourceMap> {
    // Explicit `!== null`, not truthiness — a Promise is always truthy, and the linter is right
    // that `if (promise)` reads as a mistake even when it is not one.
    if (this.refreshInFlight !== null) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      // ONE grouped query for the whole page — not one per symbol. `marketBar` is a generated
      // model, so no cast is needed; `(this.prisma as any)` would silence the very types that
      // would catch a renamed column.
      const started = Date.now();
      const grouped = await this.prisma.marketBar.groupBy({
        by: ['symbolId', 'provider'],
        where: { symbolId: { in: symbolIds } },
        _count: { _all: true },
        _max: { timestamp: true },
      });

      const map: SourceMap = new Map();
      for (const g of grouped) {
        const list = map.get(g.symbolId) ?? [];
        list.push({
          provider: g.provider,
          bars: g._count._all,
          lastBarAt: g._max.timestamp
            ? new Date(g._max.timestamp).toISOString()
            : null,
        });
        map.set(g.symbolId, list);
      }
      this.sourceCache = { at: Date.now(), map };
      this.logger.log(
        `Data-source map refreshed: ${map.size} symbol(s) with delivered bars in ` +
          `${Date.now() - started}ms (rebuilt every ${SymbolsService.SOURCE_TTL_MS / 60000}m; ` +
          'a STALE map is served during the rebuild, so this never delays a page load).',
      );
      return map;
    })();

    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
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
   * provider calls, so it is safe for page render).
   *
   * AUTHORITATIVE SOURCE for "an open position exists": `isLivePosition` from
   * `common/utils/position-freshness.ts` — the ONE shared definition of broker-maintained vs
   * cached-import rows (#854, #778). Rows outside the live window are returned separately as
   * `staleHoldings`, so the exclusion is visible rather than silent.
   */
  async getPositionMap() {
    if (!this.prisma.isAvailable) return { positions: [], staleHoldings: { count: 0, newestQuote: null, note: '' } };
    try {
      const rows = await this.prisma.position.findMany({
        orderBy: { symbol: 'asc' },
      });

      const live: typeof rows = [];
      const stale: typeof rows = [];
      for (const p of rows) {
        (isLivePosition(p.lastQuotedAt) ? live : stale).push(p);
      }

      const positions = live.map((p) => {
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
          /** When a broker sync last refreshed this row's quote — the claim behind `hasPosition`. */
          lastQuotedAt: p.lastQuotedAt instanceof Date ? p.lastQuotedAt.toISOString() : p.lastQuotedAt,
        };
      });

      let staleHoldings = { count: 0, newestQuote: null as string | null, note: '' };
      if (stale.length > 0) {
        const newest = stale.reduce((a, b) =>
          new Date(a.lastQuotedAt ?? 0).getTime() >= new Date(b.lastQuotedAt ?? 0).getTime() ? a : b,
        );
        const newestIso = newest.lastQuotedAt instanceof Date
          ? newest.lastQuotedAt.toISOString()
          : String(newest.lastQuotedAt ?? '');
        const providers = [...new Set(stale.map((p) => p.provider))].join(', ');
        staleHoldings = {
          count: stale.length,
          newestQuote: newestIso,
          note:
            `${stale.length} holding row(s) are NOT refreshed by any broker sync (${providers}; newest quote) ` +
            `${newestIso.slice(0, 10)} — they are portfolio-import records, not live positions, and are excluded ` +
            `here. See #854.`,
        };
      }

      return { positions, staleHoldings };
    } catch (error) {
      this.logger.warn(`Could not load positions for symbols browser: ${String(error)}`);
      return { positions: [], staleHoldings: { count: 0, newestQuote: null, note: '' } };
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

    // ── 5. Per-bot REALISED outcomes on this symbol (#921) ──
    //
    // WHY THIS EXISTS: the symbol views showed scores and decisions but never OUTCOMES. The
    // comparison that matters — what a bot intends (slPct/tpPct) versus what it does (avg win vs
    // avg loss) — was only obtainable by hand. #921 asks for it per bot, on one symbol.
    //
    // ⚠️⚠️ THE PHANTOM-CLOSE PREDICATE IS LOAD-BEARING. DO NOT SIMPLIFY IT TO `status='closed'`.
    // Measured 2026-09-21 (#931): 99 of 206 trade rows are marked closed but have NO brokerTicket
    // and NO exitPrice — residue of bulk reconciliation writes, with pnl = 0. 82 of those are
    // correctly flagged `pnlInvalid = 1`, but **17 are marked VALID and are not caught by any
    // existing flag**, so filtering on `pnlInvalid` is NOT sufficient.
    //
    // Consequence of getting this wrong, measured: USDCAD reads as "20 trades, 3 wins (15%)" when
    // it is really **3 trades, 3 wins**. The 17 phantom rows with pnl = 0 were being counted as
    // losses. `brokerTicket IS NOT NULL AND exitPrice IS NOT NULL` is the discriminator — a row
    // that never had a fill and never had an exit is not a trade, whatever its status says.
    const outcomeRows = (await this.prisma.$queryRawUnsafe(
      `SELECT
         scoringStrategyId                                        AS attribution,
         COUNT(*)                                                 AS trades,
         SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)                 AS wins,
         AVG(CASE WHEN pnl > 0 THEN pnl END)                      AS avgWin,
         AVG(CASE WHEN pnl <= 0 THEN pnl END)                     AS avgLoss,
         SUM(pnl)                                                 AS totalPnl,
         MIN(closedAt)                                            AS firstClose,
         MAX(closedAt)                                            AS lastClose
       FROM trade
       WHERE symbol = ?
         AND status = 'closed'
         AND brokerTicket IS NOT NULL
         AND exitPrice IS NOT NULL
       GROUP BY scoringStrategyId`,
      upperTicker,
    ).catch(() => [])) as any[];

    // Close-reason breakdown per attribution — the exit mechanism, not a count (#921).
    const reasonRows = (await this.prisma.$queryRawUnsafe(
      `SELECT scoringStrategyId AS attribution, closeReason, COUNT(*) AS n
         FROM trade
        WHERE symbol = ?
          AND status = 'closed'
          AND brokerTicket IS NOT NULL
          AND exitPrice IS NOT NULL
        GROUP BY scoringStrategyId, closeReason`,
      upperTicker,
    ).catch(() => [])) as any[];

    const reasonsByAttribution: Record<string, Record<string, number>> = {};
    for (const r of reasonRows) {
      const key = r.attribution ?? '(unattributed)';
      if (!reasonsByAttribution[key]) reasonsByAttribution[key] = {};
      // A NULL closeReason is stated, never omitted — rows predating 2026-09-14 may not have one.
      reasonsByAttribution[key][r.closeReason ?? 'unrecorded'] = Number(r.n);
    }

    const botById: Record<string, any> = {};
    for (const s of tradingStrategies) botById[s.id] = s;

    const botOutcomes = outcomeRows.map((r) => {
      const key = r.attribution ?? '(unattributed)';
      const bot = botById[key] ?? null;
      const trades = Number(r.trades);
      const wins = Number(r.wins);
      const avgWin = r.avgWin === null ? null : Number(r.avgWin);
      const avgLoss = r.avgLoss === null ? null : Number(r.avgLoss);

      // Realised payoff = avg win / |avg loss|. NULL when either side has no observations —
      // which is INFORMATION (no losses yet, or no wins yet), not a payoff of zero.
      const realisedPayoff =
        avgWin !== null && avgLoss !== null && avgLoss !== 0
          ? Number((avgWin / Math.abs(avgLoss)).toFixed(3))
          : null;

      const slPct = bot?.slPct === null || bot?.slPct === undefined ? null : Number(bot.slPct);
      const tpPct = bot?.tpPct === null || bot?.tpPct === undefined ? null : Number(bot.tpPct);
      const declaredPayoff = slPct && tpPct ? Number((tpPct / slPct).toFixed(2)) : null;

      // Win rate needs a denominator. With 0 trades there is no rate — say so rather than 0%.
      const winRate = trades > 0 ? Number(((wins / trades) * 100).toFixed(1)) : null;

      return {
        // ⚠️ `attribution` is whatever is in `scoringStrategyId`. It is USUALLY a bot UUID, but
        // measured 2026-09-21 one USDCAD row holds the PROTOCOL SLUG `forex-session-v1` instead.
        // `matchedBot` is false for those, so a consumer never silently attributes a protocol's
        // trades to a bot. Do not "fix" this by dropping the row — it is real P&L and losing it
        // would understate the symbol.
        attribution: key,
        matchedBot: bot !== null,
        botName: bot?.name ?? null,
        protocolId: bot?.protocolId ?? null,
        brokerId: bot?.brokerId ?? null,
        timeframe: bot?.timeframe ?? null,
        minComposite: bot?.minComposite ?? null,
        declared: { slPct, tpPct, declaredPayoff },
        realised: { trades, wins, winRate, avgWin, avgLoss, realisedPayoff, totalPnl: Number(r.totalPnl ?? 0) },
        closeReasons: reasonsByAttribution[key] ?? {},
        firstClose: r.firstClose,
        lastClose: r.lastClose,
      };
    }).sort((a, b) => b.realised.trades - a.realised.trades);

    // Counted so the UI can state it. Without these the phantom exclusion is invisible and the
    // numbers look like they simply do not add up.
    const phantomRows = (await this.prisma
      .$queryRawUnsafe(
        `SELECT COUNT(*) AS n FROM trade
          WHERE symbol = ? AND status = 'closed'
            AND (brokerTicket IS NULL OR exitPrice IS NULL)`,
        upperTicker,
      )
      .catch(() => [{ n: 0 }])) as any[];

    // ── 6. Build response ──
    return {
      ticker: upperTicker,
      name: dbSymbol.name,
      exchange: dbSymbol.exchange,
      type: dbSymbol.type,
      active: dbSymbol.active,
      protocols: protocolInfo,
      botOutcomes,
      outcomeCoverage: {
        // `phasedOutRows` is what #931 found and this endpoint deliberately refuses to count.
        excludedPhantomRows: Number(phantomRows[0]?.n ?? 0),
        note:
          'Rows marked closed with no brokerTicket and no exitPrice are excluded — they are bulk-write ' +
          'residue with pnl 0, not trades (#931). The filter is structural rather than the pnlInvalid ' +
          'column alone, because the original one-off quarantine used a date window and missed 17 rows ' +
          '(quarantined 2026-09-22; guard: validate-trade-phantoms.cjs).',
      },
      // ⚠️ NOT YET AVAILABLE: `minComposite` is returned above, but the protocol's MEASURED CEILING
      // is not exposed by any endpoint yet — `auditMeasuredCeilings()` lives inside a health payload
      // (protocol-health.service.ts:256) with no route of its own. #905 owns deriving it. Stated
      // explicitly so the UI shows "ceiling not available" rather than omitting the comparison and
      // implying the bar is fine.
      ceilingComparison: { available: false, blockedBy: '#905' },
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
