/**
 * Cache Controller — Monitor and manage the in-memory cache
 * ==========================================================
 * Endpoints:
 *   GET  /api/cache/stats — cache stats + all entries
 *   POST /api/cache/clear — clear entire cache
 *   POST /api/cache/prune — remove expired entries only
 */

import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CacheService } from '../../common/cache/cache.service';

@ApiTags('cache')
@Controller('cache')
export class CacheController {
  constructor(private readonly cacheService: CacheService) {}

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
}
