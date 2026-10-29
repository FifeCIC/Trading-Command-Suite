import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { Mt5Adapter } from '../providers/adapters/mt5.adapter';
import { Mt5SymbolRouter } from '../providers/mt5/mt5-symbol-router.service';

/**
 * BrokerSymbolDiscoveryService — STEP 0 of the opportunity-detection funnel (#958).
 *
 * BEFORE: nothing. The app could only ever see instruments already onboarded into `symbol`
 *         (257 rows), because that table is what every downstream consumer reads.
 * AFTER:  a catalogue of everything each broker OFFERS, refreshed daily and on demand.
 * NEXT:   the movement screen (#957 phase 1) sweeps this catalogue, and promotion turns a
 *         discovered instrument into an onboarded one.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ WHY THIS EXISTS — measured, 2026-09-22
 * ════════════════════════════════════════════════════════════════════════════
 *
 * GRML (Greenland Mines) rose **+539% in two sessions** (2.85 → 18.21 high) on a 566x volume
 * step. The MT5 bridge served 30 clean daily bars for it the whole time. The app produced
 * nothing, and could not have: with no `symbol` row, `bar-refresh` never fetched a bar, so the
 * move was **unobservable rather than un-alerted**.
 *
 * The broker's own list said, at that moment: 12,373 instruments offered, 11,448 at
 * `tradeMode: 4` (full access), 12,211 of them Nasdaq equities. The app could see 11.
 * `Mt5Adapter.loadSymbols()` had been reading that list all along — and keeping it in an
 * in-memory cache. Its only production caller asked "is THIS known symbol tradeable?", a
 * validation question. Nothing ever asked "what else is there?".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ NOT A `symbol` WRITER, AND NOT A `symbol_route` WRITER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This service writes `broker_symbol` only. It deliberately does NOT:
 *   • insert into `symbol` — that is the ONBOARDED set. Discovery registers an instrument;
 *     onboarding decides what the app does with it. Collapsing the two would make
 *     `getTopMovers`, the tier resolver and every symbol picker enumerate 12,000 instruments
 *     with no protocol, no route and no bars.
 *   • insert into `symbol_route` — that table has exactly ONE seeder
 *     (`nest/prisma/seed-symbol-onboarding.ts`) and it is the only thing that survives a
 *     reinstall. A discovery job writing routes would be a SECOND, silent writer, and the
 *     route would vanish on rebuild while the app still believed it worked.
 * See `.github/instructions/database-seed-discipline.instructions.md`.
 *
 * ⚠️ `registered` is the promotion queue, and it is a FINDING not a status: the count of
 * `registered = false AND tradeMode = 4` is the number of tradeable instruments the app has
 * never looked at. That is the gap #958 exists to make visible.
 */
@Injectable()
export class BrokerSymbolDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(BrokerSymbolDiscoveryService.name);

  /**
   * Rows per INSERT statement. 12,373 rows one-upsert-at-a-time is ~12,373 round trips and
   * takes minutes; at 400 rows/statement it is 31 statements. MySQL's placeholder ceiling is
   * 65,535 — 400 x 10 = 4,000 params, comfortably inside it.
   */
  private static readonly CHUNK = 400;

  /** Deferred first sync so a fresh install populates without a manual call, but NOT at boot. */
  private static readonly STARTUP_DELAY_MS = 180_000;
  private static readonly MAX_SUCCESS_AGE_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5Adapter,
    private readonly symbolRouter: Mt5SymbolRouter,
  ) {}

  onModuleInit(): void {
    // A fresh install must not need a human to press a button, and a catalogue older than a day
    // is the thing that silently goes wrong. Guarded so a *successful* recent sync is left alone
    // — re-running would be 12k pointless writes on every restart.
    setTimeout(() => {
      void this.syncIfStale().catch((err) =>
        this.logger.warn(`Deferred broker-symbol sync failed: ${(err as Error).message}`),
      );
    }, BrokerSymbolDiscoveryService.STARTUP_DELAY_MS);
  }

  /** Daily at 06:00 — after the 03:00 archive / 04:00 cleanup / 05:00 prune window. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'broker-symbol-discovery' })
  async scheduledSync(): Promise<void> {
    await this.syncIfStale();
  }

  /** Sync only the brokers whose catalogue is missing or more than a day old. */
  async syncIfStale(): Promise<{ synced: number[]; skipped: number[] }> {
    const synced: number[] = [];
    const skipped: number[] = [];
    for (const brokerId of this.brokerIds()) {
      const state = await this.prisma.brokerSymbolSync.findUnique({ where: { brokerId } });
      const age = state?.lastSuccessAt ? Date.now() - state.lastSuccessAt.getTime() : Infinity;
      if (age <= BrokerSymbolDiscoveryService.MAX_SUCCESS_AGE_MS) {
        skipped.push(brokerId);
        continue;
      }
      await this.syncBroker(brokerId);
      synced.push(brokerId);
    }
    return { synced, skipped };
  }

  /** Active broker slots, in declaration order (`MT5_ACTIVE_BROKERS`). */
  brokerIds(): number[] {
    return this.symbolRouter.brokerIds();
  }

  /**
   * Sync ONE broker's catalogue.
   *
   * ⚠️ THE FAILURE PATH IS THE IMPORTANT ONE. When the bridge is unreachable
   * `listBrokerInstruments()` returns `null`, and this method then:
   *   • writes NO catalogue rows — a failed sync must not look like an empty broker
   *   • does NOT advance `lastSuccessAt` — so nothing is marked stale by a failure
   *   • records `state: 'unreachable'` with the reason, so the gap is visible
   * A sync that could not read its input must ERROR, never report success with zero rows.
   */
  async syncBroker(brokerId: number): Promise<{
    brokerId: number;
    state: string;
    fetched: number;
    tradeable: number;
    registered: number;
    /** #1147 — how many routed symbols had a live spread captured. 0 is a valid count (nothing routed). */
    spreads: number;
    reason: string | null;
  }> {
    const startedAt = new Date();
    let rows: Awaited<ReturnType<Mt5Adapter['listBrokerInstruments']>>;
    try {
      rows = await this.mt5.listBrokerInstruments(brokerId);
    } catch (error) {
      const reason = `Bridge call threw: ${(error as Error).message}`;
      await this.recordState(brokerId, 'error', reason, startedAt, false);
      this.logger.error(`Broker ${brokerId} symbol sync errored — ${reason}`);
      return { brokerId, state: 'error', fetched: 0, tradeable: 0, registered: 0, spreads: 0, reason };
    }

    if (!rows || rows.length === 0) {
      const reason = 'Bridge returned no symbol list (unreachable or empty) — catalogue left untouched';
      await this.recordState(brokerId, 'unreachable', reason, startedAt, false);
      this.logger.warn(`Broker ${brokerId} symbol sync: ${reason}`);
      return { brokerId, state: 'unreachable', fetched: 0, tradeable: 0, registered: 0, spreads: 0, reason };
    }

    // Which of these the app has already onboarded. Read ONCE per sync rather than per row.
    const onboarded = new Set(
      (await this.prisma.symbol.findMany({ select: { ticker: true } })).map((s) =>
        s.ticker.toUpperCase(),
      ),
    );

    const tradeable = rows.filter((r) => r.tradeMode === 4).length;
    const registered = rows.filter((r) => onboarded.has(r.name)).length;

    for (let i = 0; i < rows.length; i += BrokerSymbolDiscoveryService.CHUNK) {
      const chunk = rows.slice(i, i + BrokerSymbolDiscoveryService.CHUNK);
      const params: unknown[] = [];
      for (const r of chunk) {
        params.push(
          randomUUID(),
          brokerId,
          r.name,
          r.path,
          this.assetClassOf(r.path),
          r.tradeMode,
          r.digits,
          r.volumeMin,
          r.volumeMax,
          onboarded.has(r.name) ? 1 : 0,
        );
      }
      // ⚠️ Row-alias form (`AS new`), not the deprecated `VALUES(col)`. MySQL 8.0.20 deprecated
      // `VALUES()` inside ON DUPLICATE KEY UPDATE and this database is MySQL 9.1.
      //
      // ⚠️ `firstSeenAt` is deliberately NOT in the column list: the DEFAULT supplies it on
      // insert, and leaving it out of the UPDATE clause means re-seeding cannot rewrite the
      // first time an instrument was ever seen. `lastSeenAt` is refreshed every sync, which is
      // what makes "no longer offered" derivable rather than guessed.
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO broker_symbol
           (id, brokerId, name, path, assetClass, tradeMode, digits, volumeMin, volumeMax, registered)
         VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
         AS new
         ON DUPLICATE KEY UPDATE
           path = new.path,
           assetClass = new.assetClass,
           tradeMode = new.tradeMode,
           digits = new.digits,
           volumeMin = new.volumeMin,
           volumeMax = new.volumeMax,
           registered = new.registered,
           lastSeenAt = UTC_TIMESTAMP(3)`,
        ...params,
      );
    }

    await this.recordState(brokerId, 'ok', null, startedAt, true, rows.length, tradeable, registered);
    this.logger.log(
      `Broker ${brokerId} symbol catalogue synced: ${rows.length} offered, ${tradeable} tradeable, ${registered} already onboarded`,
    );

    /**
     * ⚠️ SPREAD IS A QUOTE, NOT A SYMBOL PROPERTY — captured as its own step (#1147).
     *
     * The catalogue above comes from the broker's instrument list, which carries `digits`,
     * `contractSize`, `volumeMin/Max` and `tickSize` — but **no spread**, because a spread only exists
     * between a live bid and a live ask. Until 2026-10-28 nothing in the app read bids or asks into
     * storage at all, so the backtest priced every trade from a hardcoded per-asset-class guess
     * (`1% spread + 1% slippage each way` — ~250x a real instrument). The owner asked whether the
     * broker's own data reaches the app; this is the piece that did not.
     *
     * ⚠️ IT CANNOT FAIL THE CATALOGUE SYNC. Discovery's job is the list; a spread capture that cannot
     * reach the quote feed leaves `spreadPct` NULL (which the backtest reads as "not measured" and
     * falls back to the class default), and says so — it never writes a zero, because 0% spread would
     * read as a perfect fill.
     */
    let spreads = 0;
    try {
      spreads = await this.captureSpreads(brokerId);
    } catch (err) {
      this.logger.warn(
        `Broker ${brokerId} spread capture failed: ${(err as Error).message}. spreadPct stays NULL ` +
          '(NOT zero) — anything reading it falls back to the class default.',
      );
    }

    return {
      brokerId,
      state: 'ok',
      fetched: rows.length,
      tradeable,
      registered,
      spreads,
      reason: null,
    };
  }

  /**
   * Capture the LIVE spread for the symbols actually routed to this broker.
   *
   * ⚠️ ONLY ROUTED SYMBOLS, not the 12,229-instrument catalogue: a bulk quote request for the whole
   * list would hammer the bridge for data nothing reads. The set that matters is what can be traded —
   * `symbol_route` for this broker, plus anything a bot is running.
   *
   * ⚠️ `(ask - bid) / mid`, as a **PERCENT**, which is the unit `BacktestService` wants. A quote with
   * `bid == ask` (the demo feed reports 0 on FX) is recorded as measured 0 — that is a real reading and
   * is NOT the same as `NULL` = never measured.
   */
  async captureSpreads(brokerId: number): Promise<number> {
    const routes = await (this.prisma as any).symbolRoute.findMany({
      where: { brokerId, enabled: true },
      select: { symbol: true, brokerSymbol: true },
    });
    const names = [...new Set(
      (routes as Array<{ symbol: string; brokerSymbol: string | null }>)
        .map((r) => r.brokerSymbol || r.symbol)
        .filter(Boolean),
    )];
    if (names.length === 0) return 0;

    const quotes = await this.mt5.getQuotesBulk(names);
    let written = 0;
    for (const [name, q] of Object.entries(quotes ?? {})) {
      const bid = Number((q as { bid?: number })?.bid);
      const ask = Number((q as { ask?: number })?.ask);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
      const mid = (bid + ask) / 2;
      const spreadPct = ((ask - bid) / mid) * 100;
      await (this.prisma as any).brokerSymbol.updateMany({
        where: { brokerId, name },
        data: { spreadPct, spreadQuotedAt: new Date() },
      });
      written += 1;
    }
    if (written > 0) {
      this.logger.log(`Broker ${brokerId}: spread captured for ${written} routed symbol(s)`);
    }
    return written;
  }

  /** Broker's own grouping (`Nasdaq\GRML`) → first segment. Null when path is absent. */
  private assetClassOf(path: string | null): string | null {
    if (!path) return null;
    const first = path.split(/[\\/]/)[0]?.trim();
    return first ? first.slice(0, 40) : null;
  }

  private async recordState(
    brokerId: number,
    state: string,
    reason: string | null,
    at: Date,
    advanceSuccess: boolean,
    symbolCount = 0,
    tradeableCount = 0,
    registeredCount = 0,
  ): Promise<void> {
    const successAt = advanceSuccess ? at : undefined;
    await this.prisma.brokerSymbolSync.upsert({
      where: { brokerId },
      create: {
        brokerId,
        state,
        reason,
        symbolCount,
        tradeableCount,
        registeredCount,
        lastSyncAt: at,
        lastSuccessAt: successAt ?? null,
      },
      update: {
        state,
        reason,
        // Counts are only overwritten by a sync that actually read rows — otherwise a failure
        // would blank the last known numbers and the panel would read as "the broker has nothing".
        ...(advanceSuccess ? { symbolCount, tradeableCount, registeredCount } : {}),
        lastSyncAt: at,
        ...(successAt ? { lastSuccessAt: successAt } : {}),
      },
    });
  }

  /**
   * The catalogue, filtered. `registered` is the interesting filter: `false` is the backlog of
   * instruments the broker offers and the app has never onboarded.
   */
  async getCatalogue(opts: {
    brokerId?: number;
    assetClass?: string;
    registered?: boolean;
    tradeableOnly?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; limit: number; offset: number; rows: unknown[] }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where: Record<string, unknown> = {};
    if (opts.brokerId !== undefined) where.brokerId = opts.brokerId;
    if (opts.assetClass) where.assetClass = opts.assetClass;
    if (opts.registered !== undefined) where.registered = opts.registered;
    if (opts.tradeableOnly) where.tradeMode = 4;
    if (opts.search) where.name = { contains: opts.search.toUpperCase() };

    const [total, rows] = await Promise.all([
      this.prisma.brokerSymbol.count({ where }),
      this.prisma.brokerSymbol.findMany({
        where,
        orderBy: [{ assetClass: 'asc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
    ]);
    return { total, limit, offset, rows };
  }

  /**
   * The gap, as numbers. Every figure is a `COUNT(*)` against the database — not an estimate
   * (`information_schema.TABLE_ROWS` is an InnoDB estimate and has been wrong here before).
   */
  async getSummary(): Promise<{
    brokers: Array<{
      brokerId: number;
      state: string;
      reason: string | null;
      lastSyncAt: Date | null;
      lastSuccessAt: Date | null;
      offered: number;
      tradeable: number;
      onboarded: number;
      /** Offered, tradeable, and the app has never looked at it. THE number. */
      undiscoveredTradeable: number;
      /** Present in the catalogue but absent from the latest successful sync. */
      noLongerOffered: number;
    }>;
  }> {
    const brokers = [];
    for (const brokerId of this.brokerIds()) {
      const state = await this.prisma.brokerSymbolSync.findUnique({ where: { brokerId } });
      const [offered, tradeable, onboarded, undiscoveredTradeable] = await Promise.all([
        this.prisma.brokerSymbol.count({ where: { brokerId } }),
        this.prisma.brokerSymbol.count({ where: { brokerId, tradeMode: 4 } }),
        this.prisma.brokerSymbol.count({ where: { brokerId, registered: true } }),
        this.prisma.brokerSymbol.count({ where: { brokerId, tradeMode: 4, registered: false } }),
      ]);
      const noLongerOffered = state?.lastSuccessAt
        ? await this.prisma.brokerSymbol.count({
            where: { brokerId, lastSeenAt: { lt: state.lastSuccessAt } },
          })
        : 0;
      brokers.push({
        brokerId,
        // An absent state row means NEVER SYNCED — which must not render as "ok with 0 rows".
        state: state?.state ?? 'never',
        reason: state?.reason ?? null,
        lastSyncAt: state?.lastSyncAt ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        offered,
        tradeable,
        onboarded,
        undiscoveredTradeable,
        noLongerOffered,
      });
    }
    return { brokers };
  }

  /** Distinct asset classes actually present, for building a filter UI from data. */
  async getAssetClasses(brokerId?: number): Promise<Array<{ assetClass: string; count: number }>> {
    const groups = await this.prisma.brokerSymbol.groupBy({
      by: ['assetClass'],
      where: { ...(brokerId !== undefined ? { brokerId } : {}), assetClass: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { assetClass: 'desc' } },
    });
    return groups
      .filter((g) => g.assetClass)
      .map((g) => ({ assetClass: g.assetClass as string, count: g._count._all }));
  }
}
