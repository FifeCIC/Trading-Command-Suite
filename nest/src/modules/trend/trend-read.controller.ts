import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TrendReadService } from './trend-read.service';
import { TREND_MIN_BARS } from './trend-read.math';

/**
 * /api/trend/read — an OBSERVATION surface (#1190, experiment).
 *
 * ⚠️ Read the note on `TrendReadService` before extending this. The short version: this answers
 * *"what is the trend doing, and where am I wrong?"* in a form a human can check against a chart.
 * It is deliberately NOT wired into scoring — a reading that moved a score would be a maths change
 * and would need a copied configuration plus a monitored A/B.
 */
@ApiTags('trend')
// ⚠️ NO `api/` PREFIX — `main.ts` calls `app.setGlobalPrefix('api')`, so the route this serves is
// `/api/trend/read`. Writing `@Controller('api/trend')` produces `/api/api/trend`, which 404s with a
// perfectly clean "Cannot GET" that reads like the module was never registered.
@Controller('trend')
export class TrendReadController {
  constructor(private readonly trend: TrendReadService) {}

  @Get('read')
  @ApiOperation({
    summary: 'Trend reading for one symbol/cadence — fitted line, R², ADX, channel, invalidation',
  })
  @ApiQuery({ name: 'symbol', required: true, example: 'XAUUSD' })
  @ApiQuery({ name: 'timeframe', required: false, example: '1h' })
  @ApiQuery({ name: 'bars', required: false, description: `Default 200, minimum ${TREND_MIN_BARS}` })
  @ApiQuery({ name: 'horizonBars', required: false, description: 'Bars to extend the fit by. Default 10.' })
  async read(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe = '1h',
    @Query('bars') bars?: string,
    @Query('horizonBars') horizonBars?: string,
  ) {
    // ⚠️ A missing symbol is a caller error worth stating plainly, not an empty reading.
    if (!symbol) {
      throw new NotFoundException(
        'A symbol is required — e.g. `/api/trend/read?symbol=XAUUSD&timeframe=1h`.',
      );
    }
    const n = Number(bars);
    const h = Number(horizonBars);
    return this.trend.read(String(symbol), String(timeframe || '1h'), {
      bars: Number.isFinite(n) && n > 0 ? n : undefined,
      horizonBars: Number.isFinite(h) && h > 0 ? h : undefined,
    });
  }

  /** Symbols with enough bars to be readable at all — the UI offers these rather than a guess. */
  @Get('readable')
  @ApiOperation({ summary: 'Symbols with enough bars on a cadence to produce a reading' })
  async readable(@Query('timeframe') timeframe = '1h') {
    const symbols = await this.trend.readableSymbols(String(timeframe || '1h'));
    return {
      timeframe,
      minimumBars: TREND_MIN_BARS,
      count: symbols.length,
      // An empty list here is INFORMATION ("no symbol has enough bars on this cadence"), and it is
      // distinguishable from a failure because a failure throws above rather than returning [].
      symbols,
    };
  }
}
