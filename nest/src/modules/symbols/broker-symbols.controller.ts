import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { BrokerSymbolDiscoveryService } from './broker-symbol-discovery.service';
import { spreadGeometry } from './spread-geometry';
import { PrismaService } from '../../database/prisma.service';

/**
 * BrokerSymbolsController — the SURFACE for the broker catalogue (#958).
 *
 * ⚠️ DELIBERATELY A SEPARATE CONTROLLER FROM `SymbolsController`, for two reasons:
 *
 *   1. **Route shadowing.** `SymbolsController` ends with `@Get(':id')`. Any static segment
 *      registered after it (`/symbols/catalogue`) is swallowed by the `:id` parameter and
 *      returns a not-found for an id that looks like a word. Keeping catalogue routes under a
 *      different prefix makes that impossible rather than merely avoided.
 *   2. **They are different nouns.** `/api/symbols` is the ONBOARDED set — instruments the app
 *      can score, route and trade. `/api/broker-symbols` is what the BROKER OFFERS, including
 *      instruments the app has never heard of. Merging them under one prefix invites exactly
 *      the conflation the two tables exist to prevent.
 *
 * The catalogue has no UI surface yet — these endpoints are how it is read and, per
 * `.github/skills/update-architecture-framework`, how a later page will read it. A capability
 * with no surface is indistinguishable from an absent one.
 */
@Controller('broker-symbols')
export class BrokerSymbolsController {
  constructor(
    private readonly discovery: BrokerSymbolDiscoveryService,
    private readonly prisma: PrismaService,
  ) {}

  /** The gap, per broker: offered / tradeable / onboarded / never-looked-at. */
  @Get('summary')
  async summary() {
    return this.discovery.getSummary();
  }

  /** Asset classes actually present (`Nasdaq`, `Forex`, `Indexes`, `Metals`, …). */
  @Get('classes')
  async classes(@Query('brokerId') brokerId?: string) {
    return {
      classes: await this.discovery.getAssetClasses(this.intOrUndefined(brokerId)),
    };
  }

  /**
   * The discovery backlog — offered, tradeable, and never onboarded. Ordered by name so the
   * list is stable between calls; a caller wanting "most interesting" ranks it themselves,
   * because interest is a trading judgement and not something this service knows.
   */
  @Get('undiscovered')
  async undiscovered(
    @Query('brokerId') brokerId?: string,
    @Query('assetClass') assetClass?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.discovery.getCatalogue({
      brokerId: this.intOrUndefined(brokerId),
      assetClass,
      registered: false,
      tradeableOnly: true,
      limit: this.intOrUndefined(limit) ?? 100,
      offset: this.intOrUndefined(offset) ?? 0,
    });
  }

  /** The catalogue, filtered. */
  @Get()
  async list(
    @Query('brokerId') brokerId?: string,
    @Query('assetClass') assetClass?: string,
    @Query('registered') registered?: string,
    @Query('tradeableOnly') tradeableOnly?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.discovery.getCatalogue({
      brokerId: this.intOrUndefined(brokerId),
      assetClass,
      registered: registered === undefined ? undefined : registered === 'true',
      tradeableOnly: tradeableOnly === 'true',
      search,
      limit: this.intOrUndefined(limit),
      offset: this.intOrUndefined(offset),
    });
  }

  /**
   * Manual sync. Synchronous on purpose: it takes seconds and the caller wants the result.
   * A per-broker failure is reported IN the response rather than thrown, so one unreachable
   * broker does not hide the other broker's successful sync.
   */
  @Post('sync')
  async sync(@Query('brokerId') brokerId?: string) {
    const one = this.intOrUndefined(brokerId);
    if (brokerId !== undefined && one === undefined) {
      throw new BadRequestException('brokerId must be a number when supplied');
    }
    const targets = one !== undefined ? [one] : this.discovery.brokerIds();
    const results = [];
    for (const id of targets) {
      results.push(await this.discovery.syncBroker(id));
    }
    return { results };
  }

  /**
   * Capture the LIVE spread for the routed symbols (#1147) without re-reading the whole catalogue.
   *
   * ⚠️ This is the "sync on connect" the owner asked for, in the only form that can work: a spread is a
   * QUOTE, not a symbol property, so it cannot ride along with the daily catalogue sync any more cheaply
   * than this. Safe to call often — it touches only symbols `symbol_route` already points at.
   */
  @Post('spread-sync')
  async spreadSync(@Query('brokerId') brokerId?: string) {
    const one = this.intOrUndefined(brokerId);
    if (brokerId !== undefined && one === undefined) {
      throw new BadRequestException('brokerId must be a number when supplied');
    }
    const targets = one !== undefined ? [one] : this.discovery.brokerIds();
    const results = [];
    for (const id of targets) {
      const captured = await this.discovery.captureSpreads(id);
      results.push({ brokerId: id, captured });
    }
    return { results };
  }

  /** What each routed symbol's spread was last measured at — NULL is "never measured", 0 is "measured zero". */
  @Get('spreads')
  async spreads(@Query('brokerId') brokerId?: string) {
    const one = this.intOrUndefined(brokerId);
    const rows = await (this.prisma as any).brokerSymbol.findMany({
      where: {
        ...(one !== undefined ? { brokerId: one } : {}),
        spreadPct: { not: null },
      },
      select: { brokerId: true, name: true, assetClass: true, spreadPct: true, spreadQuotedAt: true },
      orderBy: [{ brokerId: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return {
      spreads: rows.map((r: any) => ({
        brokerId: r.brokerId,
        name: r.name,
        assetClass: r.assetClass,
        spreadPct: r.spreadPct,
        quotedAt: r.spreadQuotedAt?.toISOString?.() ?? null,
      })),
    };
  }

  /**
   * `GET /api/broker-symbols/spread?symbol=VIX` — the broker's measured cost for ONE symbol, in the
   * units a human can reason about (#1148).
   *
   * ⚠️ IT RETURNS POINTS **AND** PERCENT ON PURPOSE. Measured 2026-10-29: VIX quotes 0.17 points on an
   * 18-point index — **0.93%** — while US500 quotes 0.40 points on 7,722 — **0.005%**. Given only the
   * percent, both a reader and an agent concluded "VIX is expensive / the broker is bad"; the spread is
   * 17 ticks of an ordinary index CFD and the percentage is large only because the price is small.
   * `spreadToTargetRatio` is the number that actually decides anything: how much of a 1% move the spread
   * eats.
   *
   * `source` says where the value came from — `'broker'` when a quote was captured, `null` when nothing
   * has been measured for this symbol (never a fabricated zero).
   */
  @Get('spread')
  async spread(@Query('symbol') symbol?: string) {
    if (!symbol) throw new BadRequestException('symbol is required');
    const ticker = String(symbol).toUpperCase();
    const routes = await (this.prisma as any).symbolRoute.findMany({
      where: { symbol: ticker, enabled: true, provider: 'mt5' },
      select: { brokerId: true, brokerSymbol: true },
      orderBy: { brokerId: 'asc' },
    });
    for (const r of routes as Array<Record<string, unknown>>) {
      const venue = Number(r.brokerId);
      const nativeName = typeof r.brokerSymbol === 'string' && r.brokerSymbol ? r.brokerSymbol : ticker;
      const row = await (this.prisma as any).brokerSymbol.findFirst({
        where: { brokerId: venue, name: nativeName, spreadPct: { not: null } },
        select: { name: true, digits: true, spreadPct: true, spreadAbs: true, spreadQuotedAt: true },
      });
      if (!row) continue;
      const { tickSize, ticks, eatsShareOfOnePctMove } = spreadGeometry({
        spreadPct: row.spreadPct,
        spreadAbs: row.spreadAbs,
        digits: row.digits,
      });
      return {
        symbol: ticker,
        brokerId: venue,
        brokerSymbol: row.name,
        source: 'broker',
        spreadPct: row.spreadPct,
        spreadAbs: row.spreadAbs,
        tickSize,
        ticks,
        /** FRACTION of a 1% move eaten by the spread — 0.93 means a 1% target is almost entirely cost. */
        eatsShareOfOnePctMove,
        quotedAt: row.spreadQuotedAt?.toISOString?.() ?? null,
      };
    }
    return {
      symbol: ticker,
      source: null,
      spreadPct: null,
      spreadAbs: null,
      tickSize: null,
      ticks: null,
      eatsShareOfOnePctMove: null,
      quotedAt: null,
      note: 'No spread has been measured for this symbol — the backtest uses the asset-class default. POST /api/broker-symbols/spread-sync to capture it.',
    };
  }

  private intOrUndefined(value?: string): number | undefined {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
}
