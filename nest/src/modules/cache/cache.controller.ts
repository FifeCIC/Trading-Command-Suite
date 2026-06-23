/**
 * Cache Controller — Monitor and manage the in-memory cache
 * ==========================================================
 * Endpoints:
 *   GET  /api/cache/stats — cache stats + all entries
 *   POST /api/cache/clear — clear entire cache
 *   POST /api/cache/prune — remove expired entries only
 */

import { Controller, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CacheService } from '../../common/cache/cache.service';
import { TraceCacheService } from './trace-cache.service';

@ApiTags('cache')
@Controller('cache')
export class CacheController {
  constructor(
    private readonly cacheService: CacheService,
    private readonly traceCache: TraceCacheService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get cache statistics and all entries' })
  getStats() {
    return this.cacheService.getStats() as Record<string, unknown>;
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all cached data' })
  clear() {
    this.cacheService.clear();
    return { ok: true };
  }

  @Post('prune')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove only expired cache entries' })
  prune() {
    const count = this.cacheService.prune();
    return { pruned: count };
  }

  // ── API Trace Debug Endpoints ──

  @Get('traces')
  @ApiOperation({ summary: 'Get recent API call traces for debugging' })
  async getTraces() {
    return this.traceCache.getRecentTraces(50);
  }

  @Get('traces/:key')
  @ApiOperation({ summary: 'Get a specific API call trace by cache key' })
  async getTrace(@Param('key') key: string) {
    const trace = await this.traceCache.getTrace(key);
    if (!trace) return { error: 'Trace not found' };
    return trace;
  }

  @Post('traces/prune')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove expired API trace entries' })
  async pruneTraces() {
    const count = await this.traceCache.prune();
    return { pruned: count };
  }
}
