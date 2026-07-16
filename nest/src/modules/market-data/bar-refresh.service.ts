/**
 * BarRefreshService
 * ==================
 * Periodically fetches fresh OHLCV bars from the MT5 bridge
 * and upserts them into the marketBar table. This keeps all
 * directive calculations, scoring, and automation working from
 * current price data instead of stale DB snapshots.
 *
 * Runs every 5 minutes for all active trading symbols on the
 * '5m' timeframe (the primary automation timeframe). Can be
 * extended to additional timeframes as needed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';

// Avoid importing the concrete adapter class
interface BarProvider {
  getCandles?(symbol: string, timeframe: string, limit: number): Promise<any[]>;
}

@Injectable()
export class BarRefreshService {
  private readonly logger = new Logger(BarRefreshService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Symbols we always refresh regardless of active strategies. */
  private readonly ALWAYS_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDCAD', 'XAUUSD', 'US500'];

  /** Timeframes to refresh. */
  private readonly TIMEFRAMES = ['5m', '1h'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /** Start periodic refresh (every 5 min). Safe to call multiple times. */
  start(intervalMs = 300_000): void {
    if (this.timer) {
      this.logger.warn('BarRefreshService already running — skipping duplicate start');
      return;
    }
    this.logger.log(`Starting bar refresh every ${intervalMs / 1000}s`);
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

  /** Run one refresh cycle — fetch bars for all active symbols and upsert into DB. */
  async refresh(): Promise<{ upserted: number; symbols: string[]; errors: string[] }> {
    const startMs = Date.now();
    const errors: string[] = [];
    let upserted = 0;

    // Gather symbols: active strategies + always-refresh list
    const symbolSet = new Set(this.ALWAYS_SYMBOLS);
    try {
      if (this.prisma.isAvailable) {
        const strategies = await (this.prisma as any).tradingStrategy.findMany({
          where: { active: true },
          select: { symbol: true },
        });
        for (const s of strategies) symbolSet.add(s.symbol);
      }
    } catch { /* DB may not have tradingStrategy table yet */ }

    const symbols = [...symbolSet];
    if (symbols.length === 0) {
      this.logger.warn('No symbols to refresh — returning early');
      return { upserted: 0, symbols: [], errors: [] };
    }

    // Get bridge adapter for candle data
    const broker = this.adapterFactory.create('mt5') as BarProvider;
    if (!broker?.getCandles) {
      this.logger.warn('MT5 adapter unavailable — skipping bar refresh');
      return { upserted: 0, symbols: [], errors: ['MT5 adapter unavailable'] };
    }

    // Fetch and upsert bars for each symbol+timeframe combo
    for (const symbol of symbols) {
      for (const tf of this.TIMEFRAMES) {
        try {
          const bars = await broker.getCandles(symbol, tf, 100);
          if (!bars || bars.length === 0) continue;

          const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
          if (!dbSymbol) continue;

          let count = 0;
          for (const bar of bars) {
            if (!bar.timestamp || bar.open === undefined) continue;
            // INSERT ... ON DUPLICATE KEY UPDATE for reliable upsert
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
    // This ensures the latest bar in marketBar always reflects
    // the current market price, even when MT5 hasn't been running
    // continuously. Falls back gracefully if the broker doesn't
    // support quote fetches.
    for (const symbol of symbols) {
      try {
        const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
        if (!dbSymbol) continue;

        const broker2 = this.adapterFactory.create('mt5') as any;
        const quote = broker2?.getQuote ? await broker2.getQuote(symbol) : null;
        if (!quote?.bid || !quote?.ask) continue;

        const midPrice = (quote.bid + quote.ask) / 2;
        const now = new Date();

        // Insert a synthetic 5m bar using the current quote midpoint
        // Uses the @updatedAt marker so the automation loop sees this as
        // the most recent bar, even when the MT5 terminal hasn't been
        // running continuously.
        await this.prisma.$executeRaw`
          INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume)
          VALUES (UUID(), ${dbSymbol.id}, 'mt5', '5m', ${now}, ${midPrice}, ${midPrice}, ${midPrice}, ${midPrice}, 1)
          ON DUPLICATE KEY UPDATE close=${midPrice}, high=GREATEST(high,${midPrice}), low=LEAST(low,${midPrice})
        `;
      } catch { /* quote fetch may fail if broker doesn't support it */ }
    }

    const durationMs = Date.now() - startMs;
    this.logger.log(`Bar refresh complete: ${upserted} bars for ${symbols.length} symbols in ${durationMs}ms` +
      (errors.length ? ` (${errors.length} errors)` : ''));
    return { upserted, symbols, errors };
  }
}
