import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { AdapterFactory } from '../providers/adapter-factory';

type EnqueueImportInput = {
  symbolId: string;
  timeframe: string;
  provider: string;
  source: string;
};

@Injectable()
export class ImportJobsService {
  private readonly logger = new Logger(ImportJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Direct import — calls real provider adapters, not synthetic data.
   * Uses MT5 (priority 40) when available, falls back to other providers.
   */
  async importRealBars(symbolId: string, timeframe = '1d', limit = 100) {
    const symbol = await this.prisma.symbol.findUnique({ where: { id: symbolId } });
    if (!symbol) throw new NotFoundException(`Symbol ${symbolId} not found`);

    // Resolve provider-specific aliases (e.g. mt5 → "BIXI" for BTCUSD)
    const aliases = (symbol.aliases as Record<string, string>) ?? {};

    this.logger.log(`Importing real bars for ${symbol.ticker} (${timeframe})...`);

    // Try providers in priority order: MT5 → Alpha Vantage → Trading212 → Yahoo
    const providerOrder = ['mt5', 'alphavantage', 'trading212', 'yahoo'];

    for (const providerId of providerOrder) {
      try {
        const adapter = this.adapterFactory.create(providerId);
        if (!adapter) {
          this.logger.debug(`No adapter registered for ${providerId}`);
          continue;
        }

        const health = await adapter.healthCheck();
        if (!health) {
          this.logger.debug(`${providerId} health check failed`);
          continue;
        }

        // Use alias for this provider if defined, otherwise primary ticker
        const tickerToUse = aliases[providerId] || symbol.ticker;

        this.logger.log(`Fetching ${limit} ${timeframe} bars for ${tickerToUse} from ${providerId}...`);
        const bars = await adapter.getCandles(tickerToUse, timeframe, limit);

        if (!bars || bars.length === 0) {
          this.logger.debug(`${providerId} returned no bars for ${tickerToUse}`);
          continue;
        }

        // Store real bars in database
        let stored = 0;
        for (const bar of bars) {
          const existingBar = await this.prisma.marketBar.findFirst({
            where: {
              symbolId,
              timeframe,
              timestamp: new Date(bar.timestamp),
            },
          });

          if (existingBar) {
            // Update existing bar with fresh data
            await this.prisma.marketBar.update({
              where: { id: existingBar.id },
              data: {
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume ?? 0,
                provider: providerId,
              },
            });
          } else {
            await this.prisma.marketBar.create({
              data: {
                symbolId,
                provider: providerId,
                timeframe,
                timestamp: new Date(bar.timestamp),
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume ?? 0,
              },
            });
          }
          stored++;
        }

        // Update provider health
        await this.prisma.providerHealth.upsert({
          where: { provider: providerId },
          update: {
            status: 'healthy',
            message: `Imported ${stored} ${timeframe} bars for ${symbol.ticker}`,
            checkedAt: new Date(),
            credentialsOk: true,
            endpoint: providerId,
          },
          create: {
            provider: providerId,
            status: 'healthy',
            message: `Imported ${stored} ${timeframe} bars for ${symbol.ticker}`,
            checkedAt: new Date(),
            credentialsOk: true,
            endpoint: providerId,
          },
        });

        this.logger.log(`Imported ${stored} real bars for ${symbol.ticker} from ${providerId}`);
        return { symbol: symbol.ticker, provider: providerId, barsImported: stored, source: 'real' };
      } catch (err) {
        this.logger.warn(`${providerId} import failed for ${symbol.ticker}: ${(err as Error).message}`);
        // Try next provider
      }
    }

    // No provider succeeded
    this.logger.error(`All providers failed for ${symbol.ticker}. No data imported.`);
    return { symbol: symbol.ticker, provider: 'none', barsImported: 0, source: 'failed' };
  }

  // ── Batch Import ───────────────────────────────────

  private batchState: { running: boolean; total: number; done: number; currentSymbol: string; results: Array<{ ticker: string; bars: number; provider: string }>; errors: string[] } = {
    running: false, total: 0, done: 0, currentSymbol: '', results: [], errors: [],
  };

  /**
   * Batch import daily bars for a list of tickers.
   * Auto-registers symbols if they don't exist yet.
   * Uses Yahoo Finance as primary source (free, no API key needed).
   */
  async batchImport(tickers: string[], timeframe = '1d', limit = 365): Promise<{ started: boolean; message: string }> {
    if (this.batchState.running) {
      return { started: false, message: 'Batch already in progress. Check /api/imports/batch/status' };
    }

    this.batchState = { running: true, total: tickers.length, done: 0, currentSymbol: '', results: [], errors: [] };
    this.logger.log(`Batch import: ${tickers.length} symbols, ${timeframe}, limit=${limit}`);

    // Run async in background
    this.runBatchImport(tickers, timeframe, limit);

    return { started: true, message: `Importing ${tickers.length} symbols in background` };
  }

  getBatchStatus() {
    return this.batchState;
  }

  private async runBatchImport(tickers: string[], timeframe: string, limit: number): Promise<void> {
    for (const ticker of tickers) {
      this.batchState.currentSymbol = ticker;
      try {
        // Ensure symbol exists in DB
        let sym = await this.prisma.symbol.findFirst({ where: { ticker: ticker.toUpperCase() } });
        if (!sym) {
          sym = await this.prisma.symbol.create({
            data: { ticker: ticker.toUpperCase(), name: ticker, exchange: 'Yahoo', type: 'stock', active: true },
          });
          this.logger.log(`Auto-registered symbol: ${ticker}`);
        }

        const result = await this.importRealBars(sym.id, timeframe, limit);
        this.batchState.results.push({ ticker, bars: result.barsImported, provider: result.provider });
        if (result.source === 'failed') {
          this.batchState.errors.push(`${ticker}: all providers failed`);
        }
      } catch (err: any) {
        this.batchState.errors.push(`${ticker}: ${err.message}`);
      }
      this.batchState.done++;

      // Small delay between symbols to avoid rate limiting
      if (this.batchState.done < tickers.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    this.batchState.running = false;
    this.logger.log(`Batch complete: ${this.batchState.results.length} symbols, ${this.batchState.errors.length} errors`);
  }

  async enqueueImport(
    input: EnqueueImportInput,
  ): Promise<{ runId: string; queueJobId: string; imported?: number; provider?: string }> {
    const symbol = await this.prisma.symbol.findUnique({
      where: { id: input.symbolId },
    });
    if (!symbol) {
      throw new NotFoundException(`Symbol ${input.symbolId} not found`);
    }

    const run = await this.prisma.importRun.create({
      data: {
        symbolId: input.symbolId,
        provider: input.provider,
        timeframe: input.timeframe,
        status: 'running',
        source: input.source,
        startedAt: new Date(),
      },
    });

    // Queue is disabled — execute import directly instead of enqueuing
    this.logger.log(`Queue disabled — importing ${symbol.ticker} directly via adapters...`);
    const result = await this.importRealBars(input.symbolId, input.timeframe);

    await this.prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: result.source === 'real' ? 'completed' : 'failed',
        completedAt: new Date(),
      },
    });

    return {
      runId: run.id,
      queueJobId: 'direct',
      imported: result.barsImported,
      provider: result.provider,
    };
  }

  async listRecent(limit = 20) {
    const modeInfo = this.modeService.getModeInfo();
    try {
      const runs = await this.prisma.importRun.findMany({
        orderBy: [{ requestedAt: 'desc' }],
        take: limit,
        include: {
          symbol: {
            select: {
              id: true,
              ticker: true,
              name: true,
            },
          },
        },
      });
      return {
        mode: modeInfo.mode,
        services: {
          database: modeInfo.database,
          queue: modeInfo.queue,
          redis: modeInfo.redis,
        },
        runs,
      };
    } catch (error) {
      this.logger.warn(
        `Database unavailable while loading import runs: ${String(error)}`,
      );
      return {
        mode: modeInfo.mode,
        services: {
          database: modeInfo.database,
          queue: modeInfo.queue,
          redis: modeInfo.redis,
        },
        runs: [],
      };
    }
  }

  /**
   * Import raw OHLCV bars for a symbol with deduplication.
   * Auto-registers the symbol if not found. Skips duplicate (symbol+timeframe+timestamp) bars.
   *
   * @see #272 — Flexible bar import endpoint
   */
  async importBars(
    ticker: string, timeframe: string, provider: string,
    bars: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume?: number }>,
  ) {
    const sym = ticker.toUpperCase();

    // 1. Find or create symbol
    let symbol = await this.prisma.symbol.findFirst({ where: { ticker: sym } });
    if (!symbol) {
      symbol = await this.prisma.symbol.create({
        data: { ticker: sym, name: sym, type: 'stock', active: true, exchange: provider },
      });
      this.logger.log(`Auto-registered symbol: ${sym}`);
    }

    // 2. Insert bars with skipDuplicates
    let imported = 0;
    let skipped = 0;

    for (const bar of bars) {
      try {
        await this.prisma.marketBar.create({
          data: {
            symbolId: symbol.id,
            timeframe,
            timestamp: new Date(bar.timestamp),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume || 0,
            provider,
          },
        });
        imported++;
      } catch (err: any) {
        // Duplicate key (symbolId + timeframe + timestamp) — skip
        if (err.code === 'P2002') {
          skipped++;
        } else {
          this.logger.warn(`Bar insert failed for ${sym} ${bar.timestamp}: ${err.message}`);
        }
      }
    }

    this.logger.log(`Bars imported: ${sym} ${timeframe} — ${imported} new, ${skipped} skipped (${provider})`);
    return { imported, skipped, symbol: sym, timeframe, provider };
  }
}
