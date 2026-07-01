import { Controller, Get, Post, Delete, Param, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('snapshots')
export class SnapshotsController {
  private readonly logger = new Logger(SnapshotsController.name);
  private snapshots: any[] = [];

  constructor(private readonly prisma: PrismaService) {}

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

  // ── Date-range comparison ──────────────────────────────

  @Post('compare')
  async compare(@Body() body: { symbol: string; dateA: string; dateB: string; timeframe?: string }) {
    const { symbol, dateA, dateB, timeframe = '1d' } = body;
    const ticker = symbol?.toUpperCase();
    if (!ticker || !dateA || !dateB) {
      return { error: 'symbol, dateA, and dateB are required' };
    }

    const sym = await this.prisma.symbol.findFirst({ where: { ticker } });
    if (!sym) return { error: `Symbol ${ticker} not found` };

    const fetchSnapshot = async (date: string) => {
      const targetDate = new Date(date);
      // Get bars around the target date
      const bars = await this.prisma.marketBar.findMany({
        where: {
          symbolId: sym.id,
          timestamp: {
            gte: new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000),
            lte: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { timestamp: 'asc' },
        take: 100,
      });

      const closest = bars.length > 0
        ? bars.reduce((prev, curr) =>
            Math.abs(curr.timestamp.getTime() - targetDate.getTime()) <
            Math.abs(prev.timestamp.getTime() - targetDate.getTime()) ? curr : prev)
        : null;

      const chartBars = bars.slice(-30).map((b) => ({
        time: b.timestamp.toISOString().split('T')[0],
        open: b.open, high: b.high, low: b.low, close: b.close,
      }));

      return {
        date,
        closestBar: closest ? {
          timestamp: closest.timestamp.toISOString(),
          open: closest.open, high: closest.high,
          low: closest.low, close: closest.close, volume: closest.volume,
        } : null,
        barCount: bars.length,
        chartBars,
      };
    };

    const [snapA, snapB] = await Promise.all([fetchSnapshot(dateA), fetchSnapshot(dateB)]);

    const delta = snapA.closestBar && snapB.closestBar ? {
      priceChange: +(snapB.closestBar.close - snapA.closestBar.close).toFixed(2),
      priceChangePct: +((snapB.closestBar.close - snapA.closestBar.close) / snapA.closestBar.close * 100).toFixed(2),
      highChange: +(snapB.closestBar.high - snapA.closestBar.high).toFixed(2),
      lowChange: +(snapB.closestBar.low - snapA.closestBar.low).toFixed(2),
    } : null;

    return { symbol: ticker, snapA, snapB, delta };
  }
}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [SnapshotsController],
})
export class SnapshotsModule {}
