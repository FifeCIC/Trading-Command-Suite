/**
 * BarRefreshService
 * ==================
 * Periodically fetches fresh OHLCV bars from the MT5 bridge
 * and upserts them into the marketBar table. Supports two modes:
 *
 *   LIVE:   fetches 5-10 bars/symbol, every 5 min — feeds directives
 *   RECORD: fetches 100+ bars/symbol, on-demand — for backtesting
 *
 * Config via environment variables:
 *   BAR_REFRESH_LIVE_LIMIT      — bars per symbol in live mode (default 10)
 *   BAR_REFRESH_RECORD_LIMIT    — bars per symbol in record mode (default 100)
 *   BAR_REFRESH_INTERVAL_MS     — live refresh interval in ms (default 300000)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';

// Avoid importing the concrete adapter class
interface BarProvider {
  getCandles?(symbol: string, timeframe: string, limit: number): Promise<any[]>;
}

// ── Configuration ──────────────────────────────────────────

const LIVE_LIMIT = process.env.BAR_REFRESH_LIVE_LIMIT
  ? parseInt(process.env.BAR_REFRESH_LIVE_LIMIT, 10)
  : 10;

const RECORD_LIMIT = process.env.BAR_REFRESH_RECORD_LIMIT
  ? parseInt(process.env.BAR_REFRESH_RECORD_LIMIT, 10)
  : 100;

const REFRESH_INTERVAL_MS = process.env.BAR_REFRESH_INTERVAL_MS
  ? parseInt(process.env.BAR_REFRESH_INTERVAL_MS, 10)
  : 300_000; // 5 minutes

/** Timeframes to refresh. */
const TIMEFRAMES = ['5m', '1h'];

export type BarRefreshMode = 'live' | 'record';

export interface BarRefreshStatus {
  running: boolean;
  mode: BarRefreshMode;
  intervalMs: number;
  liveLimit: number;
  recordLimit: number;
  lastRefresh: string | null;
  lastUpserted: number;
  lastSymbols: number;
  lastDurationMs: number;
}

@Injectable()
export class BarRefreshService {
  private readonly logger = new Logger(BarRefreshService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private mode: BarRefreshMode = 'live';

  // Status tracking
  private lastRefresh: Date | null = null;
  private lastUpserted = 0;
  private lastSymbols = 0;
  private lastDurationMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /** Start periodic live refresh. Safe to call multiple times. */
  start(intervalMs: number = REFRESH_INTERVAL_MS): void {
    if (this.timer) {
      this.logger.warn('BarRefreshService already running — skipping duplicate start');
      return;
    }
    this.mode = 'live';
    this.logger.log(`Starting LIVE bar refresh every ${intervalMs / 1000}s (limit=${LIVE_LIMIT} bars)`);
    this.refresh().catch(err => this.logger.error(`Initial bar refresh failed: ${err.message}`));
    this.timer = setInterval(() => {
      this.refresh().catch(err => this.logger.error(`Bar refresh failed: ${err.message}`));
    }, intervalMs);
  }

  /** Stop periodic refresh. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.logger.log('BarRefreshService stopped');
  }

  /** Get current status for API. */
  getStatus(): BarRefreshStatus {
    return {
      running: this.timer !== null,
      mode: this.mode,
      intervalMs: REFRESH_INTERVAL_MS,
      liveLimit: LIVE_LIMIT,
      recordLimit: RECORD_LIMIT,
      lastRefresh: this.lastRefresh?.toISOString() ?? null,
      lastUpserted: this.lastUpserted,
      lastSymbols: this.lastSymbols,
      lastDurationMs: this.lastDurationMs,
    };
  }

  /**
   * Resolve symbols for bar refresh.
   * Tier-based: open positions + active trading strategy symbols.
   * No hardcoded ALWAYS_SYMBOLS — uses live data from the system.
   */
  async resolveRefreshSymbols(): Promise<string[]> {
    const symbolSet = new Set<string>();

    // 1. Open positions (always relevant)
    try {
      if (this.prisma.isAvailable) {
        const positions = await this.prisma.position.findMany({
          select: { symbol: true },
          distinct: ['symbol'],
        });
        for (const p of positions) symbolSet.add(p.symbol.toUpperCase());
      }
    } catch { /* no positions */ }

    // 2. Active trading strategy symbols
    try {
      if (this.prisma.isAvailable) {
        const strategies = await (this.prisma as any).tradingStrategy.findMany({
          where: { active: true },
          select: { symbol: true },
        });
        for (const s of strategies) symbolSet.add(s.symbol.toUpperCase());
      }
    } catch { /* DB may not have tradingStrategy table yet */ }

    // 3. Always include major forex/crypto pairs as floor (directive operation needs these)
    const floor = ['EURUSD', 'GBPUSD', 'USDCAD', 'XAUUSD', 'US500'];
    for (const s of floor) symbolSet.add(s);

    return [...symbolSet];
  }

  /**
   * Run one LIVE refresh cycle.
   * Fetches limited bars for active symbols — keeps directives fed.
   */
  async refresh(): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const startMs = Date.now();
    const symbols = await this.resolveRefreshSymbols();
    const result = await this.doRefresh(symbols, LIVE_LIMIT);

    this.lastRefresh = new Date();
    this.lastUpserted = result.upserted;
    this.lastSymbols = symbols.length;
    this.lastDurationMs = Date.now() - startMs;

    return result;
  }

  /**
   * Run a RECORD refresh for backtesting data.
   * Fetches many bars for watchlist symbols — opt-in, on-demand.
   * @param symbols Optional symbol list; defaults to all active DB symbols.
   */
  async recordBars(symbols?: string[]): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const startMs = Date.now();
    let targetSymbols = symbols?.length ? symbols : [];

    if (!targetSymbols.length) {
      // Default: all active DB symbols
      try {
        if (this.prisma.isAvailable) {
          const active = await this.prisma.symbol.findMany({
            where: { active: true },
            select: { ticker: true },
          });
          targetSymbols = active.map(s => s.ticker.toUpperCase());
        }
      } catch {
        targetSymbols = [];
      }
    }

    if (!targetSymbols.length) {
      this.logger.warn('No symbols for record refresh');
      return { upserted: 0, symbols: [], errors: [] };
    }

    this.logger.log(`RECORD refresh: ${targetSymbols.length} symbols, limit=${RECORD_LIMIT} bars`);
    const prevMode = this.mode;
    this.mode = 'record';
    const result = await this.doRefresh(targetSymbols, RECORD_LIMIT);
    this.mode = prevMode;

    this.lastRefresh = new Date();
    this.lastUpserted = result.upserted;
    this.lastSymbols = targetSymbols.length;
    this.lastDurationMs = Date.now() - startMs;

    return result;
  }

  /**
   * Core refresh logic — fetches bars for given symbols and upserts into DB.
   */
  private async doRefresh(
    symbols: string[],
    limit: number,
  ): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const errors: string[] = [];
    let upserted = 0;

    if (symbols.length === 0) {
      this.logger.warn('No symbols to refresh — returning early');
      return { upserted: 0, symbols: [], errors: [] };
    }

    // Get bridge adapter for candle data
    const broker = this.adapterFactory.create('mt5') as BarProvider;
    if (!broker?.getCandles) {
      this.logger.warn('MT5 adapter unavailable — skipping bar refresh');
      return { upserted: 0, symbols, errors: ['MT5 adapter unavailable'] };
    }

    // Fetch and upsert bars for each symbol+timeframe combo
    for (const symbol of symbols) {
      for (const tf of TIMEFRAMES) {
        try {
          const bars = await broker.getCandles(symbol, tf, limit);
          if (!bars || bars.length === 0) continue;

          const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
          if (!dbSymbol) continue;

          let count = 0;
          for (const bar of bars) {
            if (!bar.timestamp || bar.open === undefined) continue;
            try {
              await this.prisma.$executeRaw`
                INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
                VALUES (UUID(), ${dbSymbol.id}, 'mt5', ${tf}, ${new Date(bar.timestamp)},
                        ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.volume ?? 0})
                ON DUPLICATE KEY UPDATE open=${bar.open}, high=${bar.high}, low=${bar.low}, close=${bar.close}, volume=${bar.volume ?? 0}
              `;
              count++;
            } catch { /* duplicate — skip */ }
          }
          if (count > 0) this.logger.debug(`Upserted ${count} bars for ${symbol} (${tf})`);
          upserted += count;
        } catch (err) {
          const msg = `${symbol}/${tf}: ${(err as Error).message}`;
          this.logger.warn(`Bar refresh failed for ${msg}`);
          errors.push(msg);
        }
      }
    }

    // ── Also upsert synthetic "current" bars from live quotes ──
    for (const symbol of symbols) {
      try {
        const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
        if (!dbSymbol) continue;

        const broker2 = this.adapterFactory.create('mt5') as any;
        const quote = broker2?.getQuote ? await broker2.getQuote(symbol) : null;
        if (!quote?.bid || !quote?.ask) continue;

        const midPrice = (quote.bid + quote.ask) / 2;
        const now = new Date();

        await this.prisma.$executeRaw`
          INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
          VALUES (UUID(), ${dbSymbol.id}, 'mt5', '5m', ${now}, ${midPrice}, ${midPrice}, ${midPrice}, ${midPrice}, 1)
          ON DUPLICATE KEY UPDATE close=${midPrice}, high=GREATEST(high,${midPrice}), low=LEAST(low,${midPrice})
        `;
      } catch { /* quote fetch may fail if broker doesn't support it */ }
    }

    this.logger.log(
      `Bar refresh complete (${this.mode}): ${upserted} bars for ${symbols.length} symbols` +
      (errors.length ? ` (${errors.length} errors)` : ''),
    );
    return { upserted, symbols, errors };
  }
}
