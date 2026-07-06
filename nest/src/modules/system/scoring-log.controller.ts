/**
 * ScoringLogController — endpoints for the unified scoring log system.
 *
 * GET  /api/logs/scoring/recent       — recent log entries
 * GET  /api/logs/scoring/heatmap      — error heatmap data
 * GET  /api/logs/scoring/stream       — SSE real-time log stream
 * POST /api/logs/scoring/test         — inject a test log entry
 */

import { Controller, Get, Post, Query, Res, Sse } from '@nestjs/common';
import { Response } from 'express';
import { Observable, interval, map, startWith } from 'rxjs';
import { ScoringLogService } from './scoring-log.service';

@Controller('logs/scoring')
export class ScoringLogController {
  constructor(private readonly logService: ScoringLogService) {}

  @Get('recent')
  getRecent(@Query('limit') limit?: string, @Query('category') category?: string) {
    const lim = Math.min(200, parseInt(limit || '50', 10) || 50);
    return {
      entries: this.logService.getRecent(lim, category as any),
      count: this.logService.getBuffer().length,
      file: this.logService.getLogFilePath(),
    };
  }

  @Get('heatmap')
  getHeatmap(@Query('hours') hours?: string) {
    const h = Math.min(168, parseInt(hours || '24', 10) || 24);
    return this.logService.getHeatmap(h);
  }

  /** SSE streaming endpoint — pushes new log entries to connected clients */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    let lastIndex = this.logService.getBuffer().length;

    return interval(2000).pipe(
      startWith(0),
      map(() => {
        const current = this.logService.getBuffer();
        const newEntries = current.slice(lastIndex);
        lastIndex = current.length;

        return {
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
            newCount: newEntries.length,
            entries: newEntries.slice(-10), // Send last 10 new entries max
            total: current.length,
          }),
        } as MessageEvent;
      }),
    );
  }

  @Post('test')
  injectTest() {
    this.logService.logScoringRun({
      symbolsScored: 20,
      avgScore: 62.5,
      topSymbol: 'XAUUSD',
      topScore: 85,
      durationMs: 1234,
    });
    this.logService.logSignal({
      symbol: 'XAUUSD', composite: 85, signal: 'BUY', confidence: 72, rarity: 'strong',
    });
    this.logService.logProviderHealth({
      providerId: 'mt5', status: 'healthy',
    });
    return { injected: true, message: '4 test log entries written' };
  }
}
