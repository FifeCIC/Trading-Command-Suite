/**
 * BarRefreshService
 * ==================
 * Periodically fetches fresh OHLCV bars from the MT5 bridge
 * and upserts them into the marketBar table. Supports two modes:
 *
 *   LIVE:   fetches bars/symbol across all needed timeframes, every 5 min
 *           Default 200 bars to satisfy directives requiring deep lookback.
 *   RECORD: fetches 500+ bars/symbol, on-demand — for backtesting
 *
 * Config via environment variables:
 *   BAR_REFRESH_LIVE_LIMIT      — bars per symbol in live mode (default 200)
 *   BAR_REFRESH_RECORD_LIMIT    — bars per symbol in record mode (default 500)
 *   BAR_REFRESH_INTERVAL_MS     — live refresh interval in ms (default 300000)
 *
 * ── Three-Layer Data Provisioning Pipeline ──────────────────────────────
 *
 * This service is Layer 0 (pre-warming).  The full pipeline:
 *
 *   LAYER 0 — BarRefreshService (this file)
 *     Pre-warms the marketBar table with 200 bars across 5 timeframes
 *     (5m, 15m, 1h, 4h, 1d) every 5 minutes.  This ensures the cache
 *     is hot before any directive runs.
 *
 *   LAYER 1 — IDirective.minBars (per-directive declaration)
 *     Each directive declares `readonly minBars: Record<string, number>`
 *     mapping timeframe → minimum bar count.  Example:
 *       price-action:     { '1d': 200 }
 *       btc-halving-cycle: { '1d': 365 }
 *       mtf-confluence:    { '1d': 200, '1h': 50, '15m': 30 }
 *     File: directives/interfaces/directive.interface.ts
 *
 *   LAYER 2 — ProtocolDbService.getRequiredBars(protocolSlug)
 *     Walks all directive IDs in a protocol, collects their minBars,
 *     computes the MAX per timeframe, and returns a Record<string,number>.
 *     File: scoring/protocol-db.service.ts
 *
 *   LAYER 3 — Automation loop / Protocol Gating controller
 *     Uses getRequiredBars() to call getBars(sym, tf, requiredBars[tf])
 *     dynamically — no more hardcoded "getBars(sym, tf, 100)".
 *     Files: automation/automation-loop.service.ts,
 *            scoring/protocol-gating.controller.ts
 *
 * BEFORE this pipeline existed, directives like price-action (needing 200
 * daily bars) would starve with "need 200 bars, have 25".  The hardcoded
 * getBars(sym, tf, 100) couldn't satisfy any directive needing >100 bars.
 *
 * TIMEFRAMES expanded from ['5m','1h'] to ['5m','15m','1h','4h','1d']
 * on 2026-07-28 to support multi-timeframe directives and gold strategies.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { SymbolResolverService } from '../symbols/symbol-resolver.service';

// Avoid importing the concrete adapter class
interface BarProvider {
  getCandles?(symbol: string, timeframe: string, limit: number): Promise<any[]>;
}

// ── Configuration ──────────────────────────────────────────

const LIVE_LIMIT = process.env.BAR_REFRESH_LIVE_LIMIT
  ? parseInt(process.env.BAR_REFRESH_LIVE_LIMIT, 10)
  : 200;  // Enough to satisfy directives like price-action (200) in one cycle

const RECORD_LIMIT = process.env.BAR_REFRESH_RECORD_LIMIT
  ? parseInt(process.env.BAR_REFRESH_RECORD_LIMIT, 10)
  : 500;  // Deep lookback for backtesting

const REFRESH_INTERVAL_MS = process.env.BAR_REFRESH_INTERVAL_MS
  ? parseInt(process.env.BAR_REFRESH_INTERVAL_MS, 10)
  : 300_000; // 5 minutes

/**
 * Timeframes to refresh — covers all timeframes used by directives.
 * 5m/15m/1h/4h for intraday patterns and MTF confluence.
 * 1d for daily-based directives (the majority).
 */
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

export type BarRefreshMode = 'live' | 'record';

export interface BarRefreshStatus {
  running: boolean;
  mode: BarRefreshMode;
  intervalMs: number;
  liveLimit: number;
  recordLimit: number;
  /** Active timeframes being refreshed. */
  timeframes: string[];
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
    private readonly symbolResolver: SymbolResolverService,
    private readonly mt5Conn: Mt5ConnectionManager,
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
      timeframes: TIMEFRAMES,
      lastRefresh: this.lastRefresh?.toISOString() ?? null,
      lastUpserted: this.lastUpserted,
      lastSymbols: this.lastSymbols,
      lastDurationMs: this.lastDurationMs,
    };
  }

  /**
   * Resolve symbols for bar refresh.
   * Delegates to the shared SymbolResolverService (feature: bar-refresh).
   */
  async resolveRefreshSymbols(): Promise<string[]> {
    const selection = await this.symbolResolver.getSymbolsForFeature('bar-refresh');
    return selection.symbols;
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

    // Multi-broker fallback (#665) — when the primary bridge has no candles
    // or only stale ones (broker-side gaps), try the other configured
    // bridges and keep the freshest set.
    const primaryUrl = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';
    const fallbackUrls = this.mt5Conn.getBrokerIds()
      .map((id) => this.mt5Conn.getUrl(id))
      .filter((url) => url !== primaryUrl);
    const TF_STALE_MS: Record<string, number> = {
      '5m': 2 * 3600_000,
      '15m': 4 * 3600_000,
      '1h': 12 * 3600_000,
      '4h': 24 * 3600_000,
      '1d': 72 * 3600_000,
    };
    const newestOf = (bs: any[]) => Math.max(
      ...bs.map((b: any) => new Date(b.timestamp).getTime()).filter((t: number) => !Number.isNaN(t)),
    );
    const isStaleSet = (bs: any[], tf: string) => {
      if (!bs || !bs.length) return true;
      const threshold = TF_STALE_MS[tf] ?? 24 * 3600_000;
      return Date.now() - newestOf(bs) > threshold;
    };
    const fetchBridgeCandles = async (url: string, symbol: string, tf: string, count: number): Promise<any[]> => {
      try {
        const res = await fetch(
          `${url}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&count=${count}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) return [];
        const data: any = await res.json();
        if (!Array.isArray(data?.bars)) return [];
        return data.bars.map((b: any) => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume ?? 0,
        }));
      } catch {
        return [];
      }
    };

    // Fetch and upsert bars for each symbol+timeframe combo
    for (const symbol of symbols) {
      for (const tf of TIMEFRAMES) {
        try {
          let bars = await broker.getCandles(symbol, tf, limit);
          const primaryBad = !bars || bars.length === 0 || isStaleSet(bars, tf);
          if (primaryBad && fallbackUrls.length > 0) {
            for (const url of fallbackUrls) {
              const alt = await fetchBridgeCandles(url, symbol, tf, limit);
              if (!alt || !alt.length) continue;
              if (!bars || !bars.length || newestOf(alt) > newestOf(bars)) bars = alt;
            }
          }
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
        // Floor to the current 5m bucket so the synthetic bar matches the
        // timestamp MT5 will use for the real closed bar. This makes the
        // ON DUPLICATE KEY UPDATE hit the same row every refresh (instead of
        // inserting a new flat bar every 5 min), and lets the real bar
        // overwrite the placeholder once it closes.
        const now = new Date();
        now.setUTCSeconds(0, 0);
        now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5);

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
