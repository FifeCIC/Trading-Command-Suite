import { Controller, Get, Post, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SnapshotComparisonService } from './snapshot-comparison.service';
import { MarketDataService } from '../market-data/market-data.service';

@Controller('snapshots')
export class SnapshotsController {
  private readonly logger = new Logger(SnapshotsController.name);
  private snapshots: any[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly comparisonService: SnapshotComparisonService,
    private readonly marketData: MarketDataService,
  ) {}

  @Get()
  list() {
    return this.snapshots.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const s = this.snapshots.find((x) => x.id === id);
    if (!s) throw new Error('Not found');
    return s;
  }

  /**
   * Import real market data for a symbol + date range as a snapshot.
   * Fetches from MarketBar (DB) with MT5 bridge fallback.
   */
  @Post('import')
  async importSnapshot(@Body() body: {
    symbol: string;
    timeframe?: string;
    startDate: string;
    endDate: string;
    notes?: string;
  }) {
    const symbol = (body.symbol || '').toUpperCase();
    const timeframe = body.timeframe || '1d';
    const notes = body.notes || `Imported ${symbol} ${timeframe}`;

    if (!symbol) return { error: 'Symbol is required' };
    if (!body.startDate || !body.endDate) return { error: 'startDate and endDate are required' };

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    // Look up symbol in DB
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    const symbolId = sym?.id;

    let candleData: any[] = [];

    if (symbolId) {
      // Fetch from MarketBar table (date range)
      const bars = await this.prisma.marketBar.findMany({
        where: {
          symbolId,
          timeframe,
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: [{ timestamp: 'asc' }],
        take: 500,
      });

      candleData = bars.map((b) => ({
        timestamp: b.timestamp.toISOString(),
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: b.volume || 0,
      }));
    }

    // Fallback: try MT5 bridge if no DB data
    if (candleData.length === 0) {
      try {
        const mt5Url = `${process.env.MT5_BRIDGE_URL || 'http://localhost:5000'}/candles`;
        const res = await fetch(`${mt5Url}?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=200`);
        const mt5Data = await res.json();
        if (Array.isArray(mt5Data)) {
          candleData = mt5Data
            .filter((b: any) => {
              const t = new Date(b.time || b.timestamp);
              return t >= startDate && t <= endDate;
            })
            .map((b: any) => ({
              timestamp: new Date(b.time || b.timestamp).toISOString(),
              open: b.open, high: b.high, low: b.low, close: b.close,
              volume: b.tick_volume || b.volume || 0,
            }));
        }
      } catch (err) {
        this.logger.warn(`MT5 bridge fallback failed: ${(err as Error).message}`);
      }
    }

    const entry = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol,
      timeframe,
      startTime: body.startDate,
      endTime: body.endDate,
      candleData,
      directiveScores: null,
      notes,
      starred: false,
      createdAt: new Date().toISOString(),
      source: candleData.length > 0 && symbolId ? 'database' : candleData.length > 0 ? 'mt5-bridge' : 'empty',
    };

    this.snapshots.push(entry);
    this.logger.log(`Snapshot imported: ${symbol} ${timeframe} (${candleData.length} candles, source: ${entry.source})`);
    return entry;
  }

  @Get(':id/replay')
  replay(@Param('id') id: string) {
    const s = this.snapshots.find((x) => x.id === id);
    if (!s) throw new Error('Not found');
    return { ...s, replaySpeed: '1x', currentPosition: 0 };
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    const idx = this.snapshots.findIndex((x) => x.id === id);
    if (idx < 0) throw new Error('Not found');
    this.snapshots.splice(idx, 1);
    this.logger.log(`Snapshot deleted: ${id}`);
    return { success: true };
  }

  // ── Chart Snapshots (state captures, not images) ───────

  @Post('chart')
  async saveChartSnapshot(@Body() body: {
    symbol: string; timeframe: string; indicators?: any[];
    drawings?: any[]; annotations?: string; visibleRange?: any;
    priceAtTime?: number; tags?: string[];
  }) {
    if (!body.symbol || !body.timeframe) {
      return { error: 'symbol and timeframe are required' };
    }
    const entry = {
      id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: body.symbol.toUpperCase(),
      timeframe: body.timeframe,
      indicators: body.indicators || [],
      drawings: body.drawings || [],
      annotations: body.annotations || '',
      visibleRange: body.visibleRange || null,
      priceAtTime: body.priceAtTime ?? null,
      tags: body.tags || [],
      createdAt: new Date().toISOString(),
    };
    this.logger.log(`Chart snapshot saved: ${entry.symbol} (${entry.timeframe})`);
    return entry;
  }

  @Get('chart/list')
  listChartSnapshots() {
    // For now, returns in-memory. When Prisma migration runs, use DB.
    return this.snapshots.filter((s) => s.id?.startsWith('chart-'));
  }

  // ── Deep date-range comparison ────────────────────────

  @Post('compare')
  async compare(@Body() body: {
    symbol: string; dateA: string; dateB: string; protocolId?: string;
  }) {
    const { symbol, dateA, dateB, protocolId } = body;
    if (!symbol || !dateA || !dateB) {
      return { error: 'symbol, dateA, and dateB are required' };
    }
    try {
      return this.comparisonService.compare(symbol, dateA, dateB, protocolId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  @Post('compare/batch')
  async compareBatch(@Body() body: {
    symbols: string[]; dateA: string; dateB: string; protocolId?: string;
  }) {
    const { symbols, dateA, dateB, protocolId } = body;
    if (!symbols?.length || !dateA || !dateB) {
      return { error: 'symbols[], dateA, and dateB are required' };
    }
    const results = await Promise.allSettled(
      symbols.map((sym) =>
        this.comparisonService.compare(sym, dateA, dateB, protocolId),
      ),
    );
    return {
      comparisons: results.map((r) =>
        r.status === 'fulfilled' ? r.value : { error: (r.reason as Error).message },
      ),
    };
  }
}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ScoringModule } from '../scoring/scoring.module';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [DatabaseModule, ScoringModule, MarketDataModule],
  controllers: [SnapshotsController],
  providers: [SnapshotComparisonService],
})
export class SnapshotsModule {}
