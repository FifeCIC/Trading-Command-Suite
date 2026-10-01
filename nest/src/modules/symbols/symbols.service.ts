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
// #926 follow-up — the ONE group-shaping implementation, so the persisted breakdown renders the
// same panels the live envelope did. A copy here is what would drift.
import { shapeEnvelopeGroups } from '../../common/utils/envelope-groups';
// #926 — THE authority for "which protocols apply to this symbol". Injected rather than
// re-derived here: a second implementation of that question is the defect the issue describes.
import { SymbolProtocolAuthorityService } from './symbol-protocol-authority.service';

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
    private readonly symbolProtocolAuthority: SymbolProtocolAuthorityService,
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

    /**
     * ── COMPANY PROFILE — a provider CHAIN with a STATED OUTCOME (#966) ───────────────────────
     *
     * BEFORE: `this.adapterFactory.create('finnhub')` — ONE hardcoded provider with no fallback,
     * wrapped in `catch { /* leave null *\/ }`. A dead API key, a 429, a timeout and "this symbol
     * genuinely has no company profile" all produced the SAME `null`, and the UI rendered `—` for
     * every one of them — so the reader could not tell "we looked and there is nothing" from "we
     * could not look" (`development-philosophy` §7).
     *
     * AFTER: the chain lives in `AdapterFactory.resolveProfile()`, which derives its candidates
     * from the REGISTRY by the declared `profiles` capability, in failover-priority order. This
     * file therefore names no provider at all, and registering a new profile-capable adapter is a
     * change in `providers.module.ts` only.
     *
     * ⚠️ Measured 2026-10-01 — five registered adapters implement a real profile
     * (finnhub, fmp, polygon, yahoo, alpha-vantage) and three of them have their API key set in
     * `nest/.env`. Before this change only `finnhub` was ever asked.
     */
    const isEquity = symbol.type === 'stock' || symbol.type === 'etf';

    let industry: string | null = null;
    let marketCap: number | null = null;
    let profileStatus: 'ok' | 'not-applicable' | 'no-profile' | 'unavailable' = 'unavailable';
    let profileAnsweredBy: string | null = null;
    let profileTriedProviders: string[] = [];
    let profileReason: string | null = null;

    if (!isEquity) {
      /**
       * Only equities HAVE a company profile. Measured 2026-10-01 — `symbol.type` holds
       * stock(213) · forex(15) · etf(13) · index(9) · crypto(7) · commodity(3). Asking a provider
       * for the sector of EURUSD spends a rate-limited call to learn nothing and then reports
       * "no data", which is a DIFFERENT fact from "not applicable" and must not render the same.
       */
      profileStatus = 'not-applicable';
      profileReason = `A ${symbol.type} instrument has no company profile — providers supply quotes and contract specs for it, not fundamentals.`;
    } else {
      const resolution = await this.adapterFactory.resolveProfile(upperTicker);
      profileTriedProviders = resolution.tried;
      profileAnsweredBy = resolution.answeredBy;

      if (resolution.profile) {
        profileStatus = 'ok';
        // ⚠️ `industry` only. Finnhub's `/stock/profile2` supplies ONE classification field and
        // it fills a sector-shaped hole with an INDUSTRY ("Media", "Electrical Equipment"), so
        // the response no longer carries a `sector` key at all — see the return block below.
        industry = resolution.profile.industry ?? null;
        if (resolution.profile.marketCap) marketCap = Number(resolution.profile.marketCap);
      } else if (resolution.candidates.length === 0) {
        profileStatus = 'unavailable';
        profileReason =
          'No registered provider declares the "profiles" capability, so no lookup could be attempted.';
      } else if (resolution.emptyAnswers.length === 0 && resolution.failures.length > 0) {
        // EVERY attempt failed — we do NOT know whether a profile exists. Say so, do not say "none".
        profileStatus = 'unavailable';
        profileReason = `Every provider that was asked failed: ${resolution.failures
          .map((f) => `${f.provider} (${f.error})`)
          .join('; ')}`;
      } else {
        // At least one provider answered cleanly and had nothing — that IS information.
        profileStatus = 'no-profile';
        profileReason = resolution.failures.length
          ? `${resolution.emptyAnswers.length} provider(s) reported no profile for this symbol; ${resolution.failures.length} failed.`
          : `${resolution.tried.length} provider(s) reported no profile for this symbol.`;
      }
    }

    let metricFetchedAt: Date | null = null;
    try {
      const metric = await this.prisma.companyMetric.findUnique({
        where: { symbol: upperTicker },
      });
      if (metric?.marketCap) marketCap = Number(metric.marketCap);
      if (metric?.fetchedAt) metricFetchedAt = new Date(metric.fetchedAt);
    } catch { /* no company metric */ }

    /**
     * ⚠️⚠️ UNIT NORMALISATION — MEASURED 2026-09-23. DO NOT REMOVE.
     *
     * The two sources above return `marketCap` in DIFFERENT UNITS, and until this block existed
     * the response silently carried whichever one answered last:
     *
     *   • `adapter.getProfile()` (finnhub) → ABSOLUTE USD. The adapter multiplies Finnhub's
     *     `marketCapitalization` (which is in MILLIONS) by 1e6, so it already arrives as dollars.
     *   • `companyMetric.marketCap` (DB)   → TRILLIONS. Measured, not assumed: AAPL 4.53,
     *     NVDA 4.71, TSLA 1.48, MSFT 2.9, GOOGL 4.38, NFLX 0.33, JBL 0.04 — every one of those is
     *     plausible as $T and absurd as $M, and the DB rows are all `source='finnhub'`, fetched
     *     2026-07-03, with `sharesOutstanding = 0`.
     *
     * Both are normalised to ABSOLUTE USD below and returned as `marketCapUsd` — a name that
     * states its unit, so a future reader cannot guess wrong (there is no `marketCap` key left to
     * misinterpret).
     *
     * The consumer was off by **1,000,000×**: `SymbolsBrowserPage`'s formatter is commented
     * "marketCap is stored in millions" and rendered Apple as **"$4.53M"**. No error, no warning,
     * a plausible-looking number — the signature failure of this codebase.
     */
    const marketCapUsd =
      marketCap == null
        ? null
        : // DB rows are trillions; the profile path is already dollars. Disambiguated by
          // magnitude: nothing real is worth < $1T in the trillions column while ALSO being a
          // plausible dollar figure (a $4.53 trillion company cannot be a $4.53 company).
          marketCap < 1000
          ? marketCap * 1e12
          : marketCap;

    /**
     * ⚠️ `companyMetric` has NO refresh cadence — measured 2026-09-23 and re-measured 2026-10-01:
     * 187 rows of ~258 symbols, every `fetchedAt` 2026-07-03, `sharesOutstanding = 0` on every
     * sampled row, and a literal `marketCap = 0` on several (XAUUSD, QQQ, RDW, SNGX). Its ONLY
     * writer is `ResearchImportService.importCompanyMetricsForSymbol()`, which runs when the
     * `dilution-impact` directive happens to ask for one symbol — there is no scheduler.
     *
     * A stale number presented as current is the same defect class as a fabricated one, so the age
     * is returned and rendered rather than left for the reader to assume. `metricStale` uses 30
     * days: the row is a snapshot of a moving quantity, and a quarter of drift changes the answer.
     */
    const metricAgeDays = metricFetchedAt
      ? Math.floor((Date.now() - metricFetchedAt.getTime()) / 86_400_000)
      : null;

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
        // ⚠️ `sector` was REMOVED here, not renamed (#966). It and `industry` both carried
        // Finnhub's single `finnhubIndustry` classification, so they were IDENTICAL on every
        // populated row (measured: Technology/Technology, Semiconductors/Semiconductors,
        // Media/Media, Electrical Equipment/Electrical Equipment). The UI rendered two rows
        // showing the same string, and the one LABELLED "Sector" held an industry — "Media" and
        // "Electrical Equipment" are not sectors.
        //
        // There is no second classification to put in it: Finnhub does not supply one. Adapters
        // that DO supply both separately (fmp, yahoo, polygon) pass both through
        // `AdapterFactory.resolveProfile()`; this field carries the industry. One honest field
        // beats two where one is a duplicate. If a genuine sector source is added, add `sector`
        // back WITH it rather than re-deriving it from `industry`.
        industry,
        // ⚠️ Unit is in the NAME. Absolute USD. See the normalisation block above — the previous
        // bare `marketCap` carried trillions from one source and dollars from the other, and the
        // consumer rendered Apple as "$4.53M".
        marketCapUsd,
        // ── WHY the value is what it is. These must never be collapsed into a bare null. ──
        //   `ok`              a provider produced a profile
        //   `not-applicable`  this instrument has no company profile (FX / index / crypto / commodity)
        //   `no-profile`      providers were asked and none had one
        //   `unavailable`     the ask itself failed — we cannot judge
        profileStatus,
        profileAnsweredBy,
        profileTriedProviders,
        profileReason,
        // ── Freshness of the DB-sourced market cap, so a stale figure cannot read as current ──
        metricFetchedAt: metricFetchedAt ? metricFetchedAt.toISOString() : null,
        metricAgeDays,
        metricStale: metricAgeDays != null && metricAgeDays > 30,
      },
      price,
      ranges: { dayHigh, dayLow, historicalHigh, historicalLow },
    };
  }

  /**
   * GET /api/symbols/:ticker/protocols — cross-protocol scores for a symbol.
   *
   * ⚠️ REPLACED 2026-09-27 (#926). This method used to read `prisma.strategy` — a LEGACY table
   * with a `config.symbols` JSON blob, unrelated to `symbol_protocol_assignment` or to anything
   * else that decides which protocol scores a symbol. So it answered
   * `{"protocols":[],"count":0}` for EVERY symbol, and three surfaces learned to route around
   * it: `useSymbolEnvelope.js` calls it a dead endpoint, `view-meta.js` and `SymbolPage.jsx` both
   * carry corrections naming it, and settled-decision row 17 records the `/focus` workaround.
   *
   * It now reads `SymbolProtocolAuthorityService` — the ranked union of assignment, active bots,
   * FK-linked watchlists and observed score snapshots — so the list is the protocols that
   * ACTUALLY apply, each carrying the provenance that put it there.
   */
  async getProtocols(ticker: string) {
    const upperTicker = ticker.toUpperCase();

    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: upperTicker },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${upperTicker} not found`);

    const resolution = await this.symbolProtocolAuthority.resolve(upperTicker);
    const slugs = resolution.protocols.map((p) => p.protocolId);

    // Enrich from the REAL score source. ⚠️ `score_snapshot.protocolId` holds a SLUG, which is
    // exactly what the authority returns, so this join is direct — unlike the legacy path, which
    // read a different table's `scores` relation and could never have been about these protocols.
    //
    // ⚠️ A FAILURE HERE IS RECORDED, NOT SWALLOWED (#926). The first cut wrapped this in
    // `.catch(() => [])`, which turned a failing query into `scored: false` on every protocol —
    // "cannot read the scores" silently rendered as "has never scored". Measured: every entry
    // read `scored=false` even for protocols present BY observed evidence, i.e. the payload
    // contradicted itself. `scoreError` exists so the two states stay distinguishable.
    let scoreError: string | null = null;
    let history: any[] = [];
    if (slugs.length) {
      try {
        history = await (this.prisma as any).scoreSnapshot.findMany({
          where: { symbol: upperTicker, protocolId: { in: slugs } },
          orderBy: { snappedAt: 'desc' },
          // ⚠️ `tradingSignal` is the PRISMA field; `trading_signal` is the MySQL COLUMN. Using the
          // column name here throws `Unknown field 'trading_signal' for select statement`. The
          // first cut of this hid the throw behind `.catch(() => [])`, so every protocol read
          // `scored: false` and the payload contradicted itself. Measured 2026-09-27.
          select: { protocolId: true, composite: true, tradingSignal: true, snappedAt: true },
        });
      } catch (err) {
        scoreError = (err as Error).message;
        this.logger.warn(`getProtocols(${upperTicker}): score enrichment failed — ${scoreError}`);
      }
    }

    const byProtocol = new Map<string, any[]>();
    for (const r of history) {
      const k = String(r.protocolId);
      if (!byProtocol.has(k)) byProtocol.set(k, []);
      byProtocol.get(k)!.push(r);
    }

    // ── #926 follow-on — per-protocol STATISTICS, so protocols can be COMPARED ──
    //
    // The owner's question (2026-09-27): *"how much processing is happening, very hidden, and how
    // much data is generated, for one symbol which in the end can only trade so much… something to
    // help investigate the strongest and weakest protocols."*
    //
    // Measured for XAUUSD: **23 protocols write ~85,400 rows; six of them write ~97% of it**, and
    // `gold-macro-v1` alone wrote 12,802 rows with ZERO bots. A list of names cannot show that.
    // These three aggregates can:
    //   · `stats`   — average / best / worst score, and how many readings they rest on (n).
    //   · `bots`    — how many ACTIVE bots can actually act on the protocol.
    //   · `realised`— trades and P&L actually booked under it.
    //
    // ⚠️ `n` IS CARRIED, always. An average over 7 readings and one over 14,663 are not the same
    // claim, and this repo has been burned by a statistic quoted without its sample size.
    //
    // ⚠️ `bots: 0` DOES NOT MEAN WORTHLESS, and the numbers here are how you tell. Measured:
    // `gold-macro-v1` has **0 active bots yet 2 closed trades and +30.48 P&L** on XAUUSD. A rule
    // that skipped scoring on "no bot" would have deleted a profitable protocol. `active = 0` is
    // also NOT a kill switch (#803).
    const WINDOW_DAYS = 30;
    // ⚠️ A failure in ANY of the three aggregates is RECORDED, not swallowed. The first cut of the
    // `history` query above used `.catch(() => [])` and that is exactly how every protocol came to
    // read `scored: false` with no error anywhere (#926). Leaving stats queries silent would repeat
    // it: a wrong column name would render as "this protocol has no readings" — a plausible number
    // with no error, which is the failure shape this repo keeps re-finding.
    let statsError: string | null = null;
    let statRows: any[] = [];
    try {
      statRows = await this.prisma.$queryRawUnsafe(
        `SELECT protocolId,
                COUNT(*)              AS samples,
                AVG(composite)        AS avgScore,
                MAX(composite)        AS highScore,
                MIN(composite)        AS lowScore,
                AVG(signalPct)        AS avgSignalPct,
                MAX(snappedAt)        AS lastAt
           FROM score_snapshot
          WHERE symbol = ? AND snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          GROUP BY protocolId`,
        upperTicker,
        WINDOW_DAYS,
      );
    } catch (e) {
      statsError ??= (e as Error).message;
    }
    const statsByProtocol = new Map<string, any>();
    for (const r of statRows) statsByProtocol.set(String(r.protocolId), r);

    // Which protocols have an ACTIVE bot — one query for all of them, not one each.
    let botRows: any[] = [];
    try {
      botRows = await (this.prisma as any).tradingStrategy.groupBy({
        by: ['protocolId'],
        where: { symbol: upperTicker, active: true },
        _count: { _all: true },
      });
    } catch (e) {
      statsError ??= (e as Error).message;
    }
    const botsByProtocol = new Map<string, number>();
    for (const r of botRows) if (r.protocolId) botsByProtocol.set(String(r.protocolId), r._count?._all ?? 0);

    // Realised outcomes. ⚠️ THE PHANTOM-CLOSE PREDICATE IS LOAD-BEARING (#921/#931) — matching the
    // note in getFocus(): 99 of 206 closed rows had no fill and no exit, and 17 of those are
    // flagged VALID, so filtering on `pnlInvalid` is NOT sufficient. A row that never had a fill
    // and never had an exit is not a trade, whatever its status says.
    // ⚠️ ATTRIBUTION CAVEAT: `scoringStrategyId` holds a slug OR a bot id in different rows (#926),
    // so this join resolves what it can and the UI states the number as attributed, not certain.
    let tradeRows: any[] = [];
    try {
      tradeRows = await this.prisma.$queryRawUnsafe(
        `SELECT scoringStrategyId AS attribution,
                COUNT(*)                                          AS trades,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)          AS wins,
                SUM(pnl)                                          AS pnl
           FROM trade
          WHERE symbol = ?
            AND status = 'closed'
            AND brokerTicket IS NOT NULL
            AND exitPrice IS NOT NULL
          GROUP BY scoringStrategyId`,
        upperTicker,
      );
    } catch (e) {
      statsError ??= (e as Error).message;
    }
    const realisedByProtocol = new Map<string, any>();
    for (const r of tradeRows) if (r.attribution) realisedByProtocol.set(String(r.attribution), r);

    // ── #926 follow-up (2026-09-28) — SERVE WHAT IS ALREADY PERSISTED ──────────────────────────
    //
    // ⚠️ THE FINDING THAT MOTIVATED THIS. `SymbolPage` fetched `/api/signals/envelope/:symbol?
    // protocol=…` once per protocol to render its cards — 20 calls per view. Each is a full
    // **SCORING RUN**: gating, every directive, and `assess()` (which fetches broker positions),
    // measured at **130 ms**. The page was RE-COMPUTING 20 assessments to draw one screen.
    //
    // ⚠️ CORRECTION, 2026-09-28 — I first wrote here that the drilldown also PERSISTED a score row
    // per call, from a before/after count of the `score` table. **That was wrong, and the two
    // `persistScores()` call sites prove it:** they are inside `buildLadder` and `buildBestLadder`,
    // and `getDrilldown -> buildEnvelope` contains no persist at all. The +1 row was the
    // BACKGROUND SCORING LOOP, which writes on its own schedule. **A before/after count cannot
    // isolate a writer when something else writes too** — the correct test is to measure the loop's
    // rate first, then add the calls and look for EXCESS. The waste is real and it is COMPUTE, not
    // writes; the fix below is the same either way, but the reason must be stated correctly.
    //
    // ⚠️ IT WAS RE-COMPUTING SOMETHING ALREADY STORED. `score.breakdown` holds the whole
    // assessment: `rawComposite`, `rawMax`, `observedSignalMax`, `signal`, `rarity`, `confidence`,
    // `preTradeReady`, `opportunityPct`, `riskMultiplier` and the full `breakouts[]` directive
    // detail. Measured: **9,021 of 9,021 `score` rows carry a breakdown, 9,009 with breakouts.**
    // So the envelope call re-derived what was already on disk.
    //
    // This reads the newest persisted row per protocol in ONE query and NO writes, so the page can
    // render the same numbers from what META.Stack already produced.
    //
    // ⚠️ It is the LATEST PERSISTED reading, not a live one. That is a real semantic change and the
    // UI must say so — `at` is returned so the age is always visible, and nothing here pretends the
    // reading was taken now.
    let latestError: string | null = null;
    let latestRows: any[] = [];
    try {
      latestRows = await this.prisma.$queryRawUnsafe(
        `SELECT strategyId, breakdown, \`timestamp\` FROM (
           SELECT strategyId, breakdown, \`timestamp\`,
                  ROW_NUMBER() OVER (PARTITION BY strategyId ORDER BY \`timestamp\` DESC) rn
             FROM score
            WHERE symbolId = ?
         ) t WHERE rn = 1`,
        symbol.id,
      );
    } catch (e) {
      latestError = (e as Error).message;
    }

    /** The persisted assessment, flattened to exactly what a card needs to render. */
    const parseLatest = (raw: any): any => {
      if (!raw) return null;
      let b: any = raw;
      if (typeof b === 'string') {
        try { b = JSON.parse(b); } catch { return null; }
      }
      if (!b || typeof b !== 'object') return null;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      // ⚠️ The stable denominator is `observedSignalMax` when present, else `configuredSignalMax`,
      // else `rawMax` (INV-STABLE-DENOMINATOR). Computed here rather than stored, because
      // `signalPct` is NOT a top-level key in the persisted breakdown — a reader that assumed it
      // was would render every bar as 0.
      const denom = num(b.observedSignalMax) ?? num(b.configuredSignalMax) ?? num(b.rawMax);
      const composite = num(b.rawComposite);
      return {
        composite,
        maxPossible: denom,
        signalPct: composite !== null && denom ? (composite / denom) * 100 : null,
        opportunityPct: num(b.opportunityPct),
        rarity: b.rarity ?? b.rarityPct ?? null,
        confidence: num(b.confidence),
        preTradeReady: b.preTradeReady === true,
        blockerCount: num(b.blockerCount) ?? 0,
        signal: b.signal ?? null,
        riskMultiplier: num(b.riskMultiplier),
        denominatorMode: b.denominatorMode ?? null,
        marketStatus: b.marketStatus ?? null,
        // The directive detail the Drilldown renders — shaped by the SAME helper the live envelope
        // uses, so the two paths cannot drift. `breakouts` is kept alongside it for consumers that
        // want the raw hits; `groups` is what the panels read.
        breakouts: b.breakouts ?? null,
        groups: shapeEnvelopeGroups({ breakouts: b.breakouts, subScores: b.subScores }),
      };
    };

    const latestByProtocol = new Map<string, any>();
    for (const r of latestRows) {
      if (r.strategyId) latestByProtocol.set(String(r.strategyId), { breakdown: r.breakdown, at: r.timestamp });
    }

    const protocols = resolution.protocols.map((p) => {
      // The query is descending, so [0] is newest; the sparkline wants oldest → newest.
      const hist = byProtocol.get(p.protocolId) ?? [];
      const sparkline = hist.map((h) => Number(h.composite || 0)).reverse();
      const latest = hist[0];
      const currentScore = latest ? Number(latest.composite || 0) : 0;
      const firstScore = sparkline[0] ?? currentScore;

      return {
        id: p.protocolId,
        name: p.name,
        // ── #926 provenance: WHY this entry is in the list, and how strong the evidence is.
        // A consumer can now render "assigned" differently from "only ever observed".
        sources: p.sources,
        rank: p.rank,
        active: p.active,
        type: 'protocol',
        intendedTimeframe: p.recommendedTimeframe,
        tradingStyle: p.tradingStyle,
        directionMode: p.directionMode,
        // ⚠️ THREE states, not two: `null` = the score query FAILED, `false` = it answered and
        // this protocol has never scored, `true` = it has. Collapsing `null` into `false` is how
        // a broken query reads as "nothing here", which is the defect class this issue is about.
        scored: scoreError ? null : hist.length > 0,
        score: currentScore,
        signal: latest?.tradingSignal ?? null,
        lastScoredAt: latest?.snappedAt ? new Date(latest.snappedAt).toISOString() : null,
        trend:
          hist.length === 0
            ? null
            : currentScore > firstScore
              ? 'rising'
              : currentScore < firstScore
                ? 'falling'
                : 'flat',
        // ── #926 follow-on — the COMPARISON payload ──
        // `stats` is `null`, never zeroes, when the protocol has no readings in the window: a
        // zero average and "no readings" are different facts, and rendering them alike is the
        // failure shape this repo keeps re-finding.
        stats: (() => {
          const s = statsByProtocol.get(p.protocolId);
          if (!s) return null;
          return {
            windowDays: WINDOW_DAYS,
            // ⚠️ `samples` rides with every average. An average over 7 readings and one over
            // 14,663 are not the same claim.
            samples: Number(s.samples),
            avg: s.avgScore == null ? null : Number(s.avgScore),
            high: s.highScore == null ? null : Number(s.highScore),
            low: s.lowScore == null ? null : Number(s.lowScore),
            avgSignalPct: s.avgSignalPct == null ? null : Number(s.avgSignalPct),
            lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
          };
        })(),
        // How much of this symbol's processing can be ACTED ON. ⚠️ `0` is not "worthless" — see
        // the note above `tradeRows`.
        bots: botsByProtocol.get(p.protocolId) ?? 0,
        // Realised outcomes, `null` when none are attributed. The UI must label these as
        // ATTRIBUTED, because `scoringStrategyId` is a slug-or-bot-id (#926).
        realised: (() => {
          const t = realisedByProtocol.get(p.protocolId);
          if (!t) return null;
          return {
            trades: Number(t.trades),
            wins: Number(t.wins),
            pnl: t.pnl == null ? null : Number(t.pnl),
          };
        })(),
        // ── the PERSISTED assessment (no scoring run) ──
        // `null` when this protocol has never written a score row for this symbol — distinct from
        // a reading of zero, and the card must render those two differently.
        // ⚠️ `at` is ALWAYS returned with it. This is the latest persisted reading, not a live one,
        // and a reader must be able to see how old it is.
        latest: (() => {
          const l = latestByProtocol.get(p.protocolId);
          if (!l) return null;
          const parsed = parseLatest(l.breakdown);
          if (!parsed) return null;
          return { ...parsed, at: l.at ? new Date(l.at).toISOString() : null };
        })(),
        sparkline,
      };
    });

    return {
      symbol: upperTicker,
      protocols,
      count: protocols.length,
      // ⚠️ Surfaced, never dropped. A row pointing at a protocol that does not exist is drift the
      // reader must be able to see; skipping it silently is how "three protocols" becomes "two".
      unresolved: resolution.unresolved,
      // So a consumer can tell "nothing applies" from "the query failed".
      sourcesQueried: resolution.sourcesQueried,
      // null when the enrichment query answered; the message when it did not.
      scoreError,
      // Same contract for the three comparison aggregates (#926 follow-on).
      statsError,
      // And for the persisted-reading query — a failure here must not read as "no protocols".
      latestError,
      // ⚠️ States the window the averages cover, so a reader can never mistake a 30-day average
      // for an all-time one.
      statsWindowDays: WINDOW_DAYS,
    };
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

    // ── #926 — resolved by THE AUTHORITY, not by whichever tables happened to be reachable ──
    //
    // ⚠️ This used to build `protocolIds` from TWO sources and no authority: the scoring
    // strategies (read from **JSON files on disk** via `scoring_strategy.watchlistName`) and the
    // active bots. Measured 2026-09-27 for XAUUSD that produced **8** protocols while the symbols
    // the pipeline actually scores number **20** — and the 12 omitted included `xau-speed-v1` and
    // `xau-speed-v1-copy` (the two rows in `symbol_protocol_assignment`, i.e. the EXPLICIT
    // assignment) and `gold-macro-v1`, the one protocol with realised P&L on this symbol
    // (2 trades, +30.48). The page therefore hid exactly the protocols a reader most needs.
    //
    // ⚠️ `scoringForSymbol` still resolves from disk and yielded **0** for XAUUSD. That read is a
    // separate, still-open source of truth (see the register row for #926); it is NOT used to
    // decide which protocols exist here any more.
    const resolution = await this.symbolProtocolAuthority.resolve(upperTicker);
    const protocolIds = new Set<string>(resolution.protocols.map((p) => p.protocolId));

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
