/**
 * ScreenerController — read ScreenerHits + manual ingestion trigger (#648).
 * =====================================================================
 * GET  /api/screener/hits     — catalyst events (filter by source/symbol).
 * GET  /api/screener/ranked   — per-ticker attention ranking + transparency
 *                               counts (#682 Phase 4.1).
 * GET  /api/screener/stories  — per-ticker news stories with lean (#682 4.2).
 * POST /api/screener/promote  — promote a ticker into a watchlist (#682 4.4).
 * POST /api/screener/ingest   — run the news + earnings ingestion now.
 */
import { Body, Controller, Get, Post, Query, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ScreenerService } from './screener.service';

@Controller('screener')
export class ScreenerController {
  private readonly logger = new Logger(ScreenerController.name);

  constructor(
    private readonly screener: ScreenerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('hits')
  async hits(
    @Query('source') source?: string,
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200);
    const where: any = {};
    if (source) where.source = source;
    if (symbol) where.ticker = symbol.toUpperCase();
    const rows = await this.prisma.screenerHit.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
    });
    return { hits: rows, count: rows.length };
  }

  /**
   * Ranked catalysts (epic #682 Phase 4.1) — hits grouped per ticker and
   * ordered by attention weight, plus universe transparency counts.
   */
  @Get('ranked')
  async ranked(
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit || '100', 10) || 100, 1), 200);
    return this.screener.ranked(take, source);
  }

  /** Per-ticker news stories with LONG/SHORT/NEUTRAL lean (#682 Phase 4.2). */
  @Get('stories')
  async stories(
    @Query('ticker') ticker?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit || '20', 10) || 20, 1), 50);
    return this.screener.stories(ticker || '', take);
  }

  /** Manual promote-to-watchlist (#682 Phase 4.4) — 1:1 hit provenance. */
  @Post('promote')
  async promote(
    @Body() body: { ticker?: string; watchlistId?: string; watchlistName?: string },
  ) {
    return this.screener.promote(body.ticker || '', body.watchlistId, body.watchlistName);
  }

  @Post('ingest')
  async ingest() {
    const result = await this.screener.runIngestion();
    this.logger.log(
      `Manual screener ingestion: news +${result.news.created}, earnings +${result.earnings.created}`,
    );
    return result;
  }
}
