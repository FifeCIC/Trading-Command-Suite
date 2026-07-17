/**
 * Snapshots Controller
 * ====================
 * Phase 1: Capture and browse market snapshots for testing (#294).
 */

import { Controller, Get, Post, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('snapshots')
export class SnapshotsController {
  private readonly logger = new Logger(SnapshotsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async capture(@Body() body: {
    symbol: string; timeframe: string; startTime: string; endTime: string;
    candleData: any; directiveScores?: any; notes?: string; starred?: boolean;
  }) {
    if (!body.symbol || !body.timeframe) return { error: 'symbol and timeframe required' };
    const snap = await this.prisma.marketSnapshot.create({ data: {
      symbol: body.symbol.toUpperCase(), timeframe: body.timeframe,
      startTime: body.startTime ? new Date(body.startTime) : new Date(),
      endTime: body.endTime ? new Date(body.endTime) : new Date(),
      candleData: body.candleData || {}, directiveScores: body.directiveScores || null,
      notes: body.notes || null, starred: body.starred || false,
    }});
    this.logger.log(`Snapshot: ${snap.symbol} ${snap.timeframe}`);
    return { captured: true, id: snap.id };
  }

  @Get()
  async list(@Query('symbol') symbol?: string, @Query('starred') starred?: string, @Query('limit') limit = 50) {
    const where: any = {};
    if (symbol) where.symbol = symbol.toUpperCase();
    if (starred === 'true') where.starred = true;
    const snapshots = await this.prisma.marketSnapshot.findMany({
      where, orderBy: { createdAt: 'desc' }, take: Math.min(+limit, 200),
      select: { id: true, symbol: true, timeframe: true, startTime: true, endTime: true, notes: true, starred: true, createdAt: true },
    });
    return { snapshots, count: snapshots.length };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return await this.prisma.marketSnapshot.findUnique({ where: { id } }) || { error: 'Not found' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.marketSnapshot.delete({ where: { id } }).catch(() => null);
    return { deleted: true };
  }
}
