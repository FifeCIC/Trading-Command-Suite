import { Controller, Get, Post, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SnapshotComparisonService } from './snapshot-comparison.service';

@Controller('snapshots')
export class SnapshotsController {
  private readonly logger = new Logger(SnapshotsController.name);
  private snapshots: any[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly comparisonService: SnapshotComparisonService,
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

  @Post()
  save(@Body() body: any) {
    const entry = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: body.symbol || 'UNKNOWN',
      timeframe: body.timeframe || '1h',
      startTime: body.startTime || new Date().toISOString(),
      endTime: body.endTime || new Date().toISOString(),
      candleData: body.candleData || [],
      directiveScores: body.directiveScores || null,
      notes: body.notes || '',
      starred: false,
      createdAt: new Date().toISOString(),
    };
    this.snapshots.push(entry);
    this.logger.log(`Snapshot saved: ${entry.symbol} (${entry.candleData.length || 0} candles)`);
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

@Module({
  imports: [DatabaseModule, ScoringModule],
  controllers: [SnapshotsController],
  providers: [SnapshotComparisonService],
})
export class SnapshotsModule {}
