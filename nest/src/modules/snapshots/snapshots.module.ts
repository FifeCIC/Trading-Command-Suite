import { Controller, Get, Post, Delete, Param, Body, Logger } from '@nestjs/common';

@Controller('snapshots')
export class SnapshotsController {
  private readonly logger = new Logger(SnapshotsController.name);
  private snapshots: any[] = [];

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
}

import { Module } from '@nestjs/common';

@Module({
  controllers: [SnapshotsController],
})
export class SnapshotsModule {}
